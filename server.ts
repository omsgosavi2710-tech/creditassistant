import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb, queryAll, queryOne, execute } from './server/db.js';
import {
  analyzeCreditHealth,
  askCreditChatbot,
  FinancialContext,
} from './server/gemini.js';
import {
  calculateMetrics,
  simulateScoreImpact,
  calculateDebtPayoffStrategies,
  SimulationAction,
} from './server/financial_engine.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const JWT_SECRET = process.env.SECRET_KEY || 'credit-assistant-jwt-secret-token-key-2026';

app.use(express.json());

// Request logging
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[API] ${req.method} ${req.path}`);
  }
  next();
});

// Auth Middleware
interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'Credit Assistant API' });
});

function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded: any) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    next();
  });
}

// ======================== AUTH ROUTES ======================== //

app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();

    await execute(
      'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      [userId, name.trim(), email.toLowerCase().trim(), passwordHash, now]
    );

    // Initial default profile
    const profileId = 'prof_' + Date.now();
    await execute(
      `INSERT INTO financial_profiles (
        id, user_id, monthly_income, monthly_expenses, monthly_debt_payment,
        credit_score, credit_limit, outstanding_credit, active_loans, missed_payments,
        financial_goal, dti, credit_utilization, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profileId,
        userId,
        60000,
        30000,
        18000,
        680,
        120000,
        38000,
        1,
        0,
        'Improve score to 750+ for home loan approval',
        30.0,
        31.7,
        now,
      ]
    );

    // Initial credit score history
    await execute(
      'INSERT INTO credit_score_history (id, user_id, score, delta, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['csh_' + Date.now(), userId, 680, 0, 'Initial score record on registration', now]
    );

    const token = jwt.sign({ userId, email: email.toLowerCase().trim() }, JWT_SECRET, { expiresIn: '7d' });
    return res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: userId, name: name.trim(), email: email.toLowerCase().trim() },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error during registration' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await queryOne<{ id: string; name: string; email: string; password_hash: string }>(
      'SELECT id, name, email, password_hash FROM users WHERE email = ?',
      [email.toLowerCase().trim()]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  return res.json({ message: 'Logged out successfully' });
});

app.get('/api/users/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<{ id: string; name: string; email: string; created_at: string }>(
      'SELECT id, name, email, created_at FROM users WHERE id = ?',
      [req.userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ======================== PROFILE ROUTES ======================== //

app.get('/api/profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const profile = await queryOne('SELECT * FROM financial_profiles WHERE user_id = ?', [req.userId]);
    if (!profile) {
      return res.status(404).json({ error: 'Financial profile not found' });
    }

    const metrics = calculateMetrics(
      profile.monthly_income,
      profile.monthly_debt_payment,
      profile.monthly_expenses,
      profile.outstanding_credit,
      profile.credit_limit
    );

    // Get last score delta from history
    const history = await queryAll<{ score: number }>(
      'SELECT score FROM credit_score_history WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 2',
      [req.userId]
    );

    const latestDelta = history.length > 1 ? history[0].score - history[1].score : 0;

    return res.json({
      ...profile,
      metrics,
      improvement_delta: latestDelta,
    });
  } catch (error: any) {
    console.error('Error fetching profile:', error);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.put('/api/profile', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const {
      monthly_income,
      monthly_expenses,
      monthly_debt_payment,
      credit_score,
      credit_limit,
      outstanding_credit,
      active_loans,
      missed_payments,
      financial_goal,
    } = req.body;

    const currentProfile = await queryOne('SELECT * FROM financial_profiles WHERE user_id = ?', [req.userId]);
    const prevScore = currentProfile ? currentProfile.credit_score : credit_score;

    const incomeVal = Math.max(0, Number(monthly_income) || 0);
    const expensesVal = Math.max(0, Number(monthly_expenses) || 0);
    const debtVal = Math.max(0, Number(monthly_debt_payment) || 0);
    const scoreVal = Math.min(900, Math.max(300, Number(credit_score) || 650));
    const limitVal = Math.max(1, Number(credit_limit) || 1);
    const outCreditVal = Math.max(0, Number(outstanding_credit) || 0);
    const loansVal = Math.max(0, Number(active_loans) || 0);
    const missedVal = Math.max(0, Number(missed_payments) || 0);

    const metrics = calculateMetrics(incomeVal, debtVal, expensesVal, outCreditVal, limitVal);
    const now = new Date().toISOString();

    if (currentProfile) {
      await execute(
        `UPDATE financial_profiles SET
          monthly_income = ?, monthly_expenses = ?, monthly_debt_payment = ?,
          credit_score = ?, credit_limit = ?, outstanding_credit = ?,
          active_loans = ?, missed_payments = ?, financial_goal = ?,
          dti = ?, credit_utilization = ?, updated_at = ?
         WHERE user_id = ?`,
        [
          incomeVal,
          expensesVal,
          debtVal,
          scoreVal,
          limitVal,
          outCreditVal,
          loansVal,
          missedVal,
          financial_goal || currentProfile.financial_goal,
          metrics.dti,
          metrics.credit_utilization,
          now,
          req.userId,
        ]
      );
    } else {
      await execute(
        `INSERT INTO financial_profiles (
          id, user_id, monthly_income, monthly_expenses, monthly_debt_payment,
          credit_score, credit_limit, outstanding_credit, active_loans, missed_payments,
          financial_goal, dti, credit_utilization, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'prof_' + Date.now(),
          req.userId,
          incomeVal,
          expensesVal,
          debtVal,
          scoreVal,
          limitVal,
          outCreditVal,
          loansVal,
          missedVal,
          financial_goal || 'Improve credit health',
          metrics.dti,
          metrics.credit_utilization,
          now,
        ]
      );
    }

    // Record score history if score changed
    let delta = 0;
    if (prevScore !== scoreVal) {
      delta = scoreVal - prevScore;
      await execute(
        'INSERT INTO credit_score_history (id, user_id, score, delta, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['csh_' + Date.now(), req.userId, scoreVal, delta, 'Profile score update', now]
      );
    }

    const updated = await queryOne('SELECT * FROM financial_profiles WHERE user_id = ?', [req.userId]);
    return res.json({
      ...updated,
      metrics,
      improvement_delta: delta,
      message: 'Financial profile updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating profile:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ======================== CREDIT SCORE HISTORY ROUTES ======================== //

app.get('/api/credit-score/history', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const history = await queryAll(
      'SELECT id, score, delta, note, recorded_at FROM credit_score_history WHERE user_id = ? ORDER BY recorded_at ASC',
      [req.userId]
    );
    return res.json(history);
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch credit score history' });
  }
});

app.post('/api/credit-score', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { score, note } = req.body;
    const numScore = Math.min(900, Math.max(300, Number(score)));
    if (isNaN(numScore)) {
      return res.status(400).json({ error: 'Valid credit score (300-900) is required' });
    }

    const lastEntry = await queryOne<{ score: number }>(
      'SELECT score FROM credit_score_history WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1',
      [req.userId]
    );

    const prevScore = lastEntry ? lastEntry.score : numScore;
    const delta = numScore - prevScore;
    const now = new Date().toISOString();

    const id = 'csh_' + Date.now();
    await execute(
      'INSERT INTO credit_score_history (id, user_id, score, delta, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.userId, numScore, delta, note || 'Score logged', now]
    );

    // Update profile score
    await execute(
      'UPDATE financial_profiles SET credit_score = ?, updated_at = ? WHERE user_id = ?',
      [numScore, now, req.userId]
    );

    const history = await queryAll(
      'SELECT id, score, delta, note, recorded_at FROM credit_score_history WHERE user_id = ? ORDER BY recorded_at ASC',
      [req.userId]
    );

    return res.status(201).json({
      message: 'Credit score logged successfully',
      current_score: numScore,
      delta,
      history,
    });
  } catch (error: any) {
    console.error('Error logging score:', error);
    return res.status(500).json({ error: 'Failed to record credit score' });
  }
});

// ======================== LOAN TRACKING ROUTES ======================== //

app.get('/api/loans', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const loans = await queryAll('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC', [req.userId]);
    const totalOutstanding = loans.reduce((acc, l) => acc + (l.status === 'active' ? l.outstanding_amount : 0), 0);
    const totalEmi = loans.reduce((acc, l) => acc + (l.status === 'active' ? l.emi : 0), 0);
    return res.json({ loans, total_outstanding: totalOutstanding, total_monthly_emi: totalEmi });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

app.post('/api/loans', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, principal, outstanding_amount, emi, interest_rate, start_date, end_date, status } = req.body;
    if (!name || !type || principal === undefined) {
      return res.status(400).json({ error: 'Loan name, type, and principal are required' });
    }

    const loanId = 'loan_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();

    await execute(
      `INSERT INTO loans (
        id, user_id, name, type, principal, outstanding_amount, emi, interest_rate, start_date, end_date, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        loanId,
        req.userId,
        name.trim(),
        type,
        Number(principal) || 0,
        outstanding_amount !== undefined ? Number(outstanding_amount) : Number(principal) || 0,
        Number(emi) || 0,
        Number(interest_rate) || 10.5,
        start_date || now.split('T')[0],
        end_date || '',
        status || 'active',
        now,
      ]
    );

    // Sync active loans count and debt payments on profile
    const activeLoans = await queryAll<{ emi: number }>(
      "SELECT emi FROM loans WHERE user_id = ? AND status = 'active'",
      [req.userId]
    );
    const newDebtPayment = activeLoans.reduce((sum, l) => sum + l.emi, 0);

    await execute(
      `UPDATE financial_profiles SET
        active_loans = ?,
        monthly_debt_payment = ?,
        updated_at = ?
       WHERE user_id = ?`,
      [activeLoans.length, newDebtPayment, now, req.userId]
    );

    const loans = await queryAll('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC', [req.userId]);
    return res.status(201).json({ message: 'Loan added successfully', loans });
  } catch (error: any) {
    console.error('Error adding loan:', error);
    return res.status(500).json({ error: 'Failed to add loan' });
  }
});

app.put('/api/loans/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const loanId = req.params.id;
    const { name, type, principal, outstanding_amount, emi, interest_rate, start_date, end_date, status } = req.body;

    const existing = await queryOne('SELECT id FROM loans WHERE id = ? AND user_id = ?', [loanId, req.userId]);
    if (!existing) return res.status(404).json({ error: 'Loan not found' });

    await execute(
      `UPDATE loans SET
        name = ?, type = ?, principal = ?, outstanding_amount = ?, emi = ?, interest_rate = ?,
        start_date = ?, end_date = ?, status = ?
       WHERE id = ? AND user_id = ?`,
      [
        name,
        type,
        Number(principal) || 0,
        Number(outstanding_amount) || 0,
        Number(emi) || 0,
        Number(interest_rate) || 0,
        start_date,
        end_date,
        status || 'active',
        loanId,
        req.userId,
      ]
    );

    // Refresh profile active loans & emi
    const activeLoans = await queryAll<{ emi: number }>(
      "SELECT emi FROM loans WHERE user_id = ? AND status = 'active'",
      [req.userId]
    );
    const newDebt = activeLoans.reduce((sum, l) => sum + l.emi, 0);
    await execute(
      'UPDATE financial_profiles SET active_loans = ?, monthly_debt_payment = ?, updated_at = ? WHERE user_id = ?',
      [activeLoans.length, newDebt, new Date().toISOString(), req.userId]
    );

    const loans = await queryAll('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC', [req.userId]);
    return res.json({ message: 'Loan updated successfully', loans });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to update loan' });
  }
});

app.delete('/api/loans/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const loanId = req.params.id;
    await execute('DELETE FROM loans WHERE id = ? AND user_id = ?', [loanId, req.userId]);

    const activeLoans = await queryAll<{ emi: number }>(
      "SELECT emi FROM loans WHERE user_id = ? AND status = 'active'",
      [req.userId]
    );
    const newDebt = activeLoans.reduce((sum, l) => sum + l.emi, 0);
    await execute(
      'UPDATE financial_profiles SET active_loans = ?, monthly_debt_payment = ?, updated_at = ? WHERE user_id = ?',
      [activeLoans.length, newDebt, new Date().toISOString(), req.userId]
    );

    const loans = await queryAll('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC', [req.userId]);
    return res.json({ message: 'Loan deleted successfully', loans });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to delete loan' });
  }
});

// ======================== MISSED PAYMENTS ROUTES ======================== //

app.get('/api/missed-payments', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const items = await queryAll('SELECT * FROM missed_payments WHERE user_id = ? ORDER BY payment_date DESC', [req.userId]);
    const unresolvedCount = items.filter(i => i.status === 'missed').length;
    return res.json({
      missed_payments: items,
      unresolved_count: unresolvedCount,
      guidance: 'Timely repayments are crucial. Even a single 30-day delinquency can decrease a credit score by 40-70 points in India.',
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch missed payments' });
  }
});

app.post('/api/missed-payments', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { loan_name, amount, payment_date, note } = req.body;
    if (!loan_name || !amount) {
      return res.status(400).json({ error: 'Loan/account name and amount are required' });
    }

    const id = 'mp_' + Date.now();
    const now = new Date().toISOString();

    await execute(
      'INSERT INTO missed_payments (id, user_id, loan_name, amount, payment_date, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.userId, loan_name, Number(amount) || 0, payment_date || now.split('T')[0], 'missed', note || '', now]
    );

    // Update missed payments count in profile
    const countRow = await queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM missed_payments WHERE user_id = ? AND status = 'missed'",
      [req.userId]
    );
    const count = countRow ? countRow.count : 1;

    await execute(
      'UPDATE financial_profiles SET missed_payments = ?, updated_at = ? WHERE user_id = ?',
      [count, now, req.userId]
    );

    const items = await queryAll('SELECT * FROM missed_payments WHERE user_id = ? ORDER BY payment_date DESC', [req.userId]);
    return res.status(201).json({ message: 'Missed payment logged', missed_payments: items });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to log missed payment' });
  }
});

app.put('/api/missed-payments/:id/resolve', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id;
    await execute("UPDATE missed_payments SET status = 'resolved' WHERE id = ? AND user_id = ?", [id, req.userId]);

    const countRow = await queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM missed_payments WHERE user_id = ? AND status = 'missed'",
      [req.userId]
    );
    const count = countRow ? countRow.count : 0;

    await execute(
      'UPDATE financial_profiles SET missed_payments = ?, updated_at = ? WHERE user_id = ?',
      [count, new Date().toISOString(), req.userId]
    );

    const items = await queryAll('SELECT * FROM missed_payments WHERE user_id = ? ORDER BY payment_date DESC', [req.userId]);
    return res.json({ message: 'Marked as resolved', missed_payments: items });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to resolve missed payment' });
  }
});

// ======================== AI ADVISOR & CHATBOT ROUTES ======================== //

app.post('/api/ai/analyze', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const profile = await queryOne('SELECT * FROM financial_profiles WHERE user_id = ?', [req.userId]);
    if (!profile) {
      return res.status(404).json({ error: 'Please complete your financial profile first' });
    }

    const loans = await queryAll(
      "SELECT name, type, outstanding_amount, emi, interest_rate FROM loans WHERE user_id = ? AND status = 'active'",
      [req.userId]
    );

    const context: FinancialContext = {
      credit_score: profile.credit_score,
      monthly_income: profile.monthly_income,
      monthly_expenses: profile.monthly_expenses,
      monthly_debt_payment: profile.monthly_debt_payment,
      credit_limit: profile.credit_limit,
      outstanding_credit: profile.outstanding_credit,
      dti: profile.dti,
      credit_utilization: profile.credit_utilization,
      active_loans: profile.active_loans,
      missed_payments: profile.missed_payments,
      financial_goal: profile.financial_goal,
      loans,
    };

    const analysis = await analyzeCreditHealth(context);

    // Save recommendation to database
    const recId = 'rec_' + Date.now();
    await execute(
      'INSERT INTO ai_recommendations (id, user_id, summary, health_status, recommendations_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [recId, req.userId, analysis.summary, analysis.health_status, JSON.stringify(analysis), new Date().toISOString()]
    );

    return res.json({
      id: recId,
      ...analysis,
      analyzed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error generating AI analysis:', error);
    return res.status(500).json({ error: 'Failed to analyze credit health. Please try again.' });
  }
});

app.get('/api/ai/latest', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const rec = await queryOne<{ id: string; summary: string; health_status: string; recommendations_json: string; created_at: string }>(
      'SELECT * FROM ai_recommendations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.userId]
    );

    if (!rec) return res.json({ recommendation: null });

    const data = JSON.parse(rec.recommendations_json);
    return res.json({
      id: rec.id,
      ...data,
      created_at: rec.created_at,
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to load recommendation' });
  }
});

app.post('/api/ai/chat', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const profile = await queryOne('SELECT * FROM financial_profiles WHERE user_id = ?', [req.userId]);
    const context: FinancialContext | undefined = profile
      ? {
          credit_score: profile.credit_score,
          monthly_income: profile.monthly_income,
          monthly_expenses: profile.monthly_expenses,
          monthly_debt_payment: profile.monthly_debt_payment,
          credit_limit: profile.credit_limit,
          outstanding_credit: profile.outstanding_credit,
          dti: profile.dti,
          credit_utilization: profile.credit_utilization,
          active_loans: profile.active_loans,
          missed_payments: profile.missed_payments,
          financial_goal: profile.financial_goal,
        }
      : undefined;

    // Save user message
    const now = new Date().toISOString();
    await execute(
      'INSERT INTO chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      ['msg_' + Date.now(), req.userId, 'user', message, now]
    );

    // Get recent chat history
    const history = await queryAll<{ role: 'user' | 'assistant'; content: string }>(
      'SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 12',
      [req.userId]
    );

    const assistantReply = await askCreditChatbot(history, context);

    // Save assistant reply
    await execute(
      'INSERT INTO chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      ['msg_' + (Date.now() + 1), req.userId, 'assistant', assistantReply, new Date().toISOString()]
    );

    return res.json({
      reply: assistantReply,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Chatbot error:', error);
    return res.status(500).json({ error: 'Failed to get answer from chatbot' });
  }
});

app.get('/api/ai/chat/history', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const messages = await queryAll(
      'SELECT id, role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 30',
      [req.userId]
    );
    return res.json(messages);
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// ======================== CREDIT SCORE SIMULATOR & DEBT PAYOFF ======================== //

app.post('/api/simulator/simulate', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const action: SimulationAction = req.body;
    const profile = await queryOne('SELECT * FROM financial_profiles WHERE user_id = ?', [req.userId]);

    const currentScore = profile ? profile.credit_score : 680;
    const outstanding = profile ? profile.outstanding_credit : 35000;
    const limit = profile ? profile.credit_limit : 100000;
    const monthlyDebt = profile ? profile.monthly_debt_payment : 15000;
    const income = profile ? profile.monthly_income : 50000;

    const result = simulateScoreImpact(currentScore, outstanding, limit, monthlyDebt, income, action);
    return res.json(result);
  } catch (error: any) {
    console.error('Simulation error:', error);
    return res.status(500).json({ error: 'Failed to run credit score simulation' });
  }
});

app.get('/api/debt-payoff/strategies', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const extra = req.query.extra ? Number(req.query.extra) : 5000;
    const loans = await queryAll(
      "SELECT id, name, type, outstanding_amount, emi, interest_rate FROM loans WHERE user_id = ? AND status = 'active'",
      [req.userId]
    );

    const strategies = calculateDebtPayoffStrategies(loans, extra);
    return res.json(strategies);
  } catch (error: any) {
    console.error('Debt payoff calculation error:', error);
    return res.status(500).json({ error: 'Failed to calculate debt payoff strategies' });
  }
});

// ======================== BANKING API & BUDGET TRACKING ======================== //

app.get('/api/banking/accounts', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    let accounts = await queryAll('SELECT * FROM bank_accounts WHERE user_id = ?', [req.userId]);

    // If no accounts yet, seed with standard Indian sandbox banks
    if (accounts.length === 0) {
      const now = new Date().toISOString();
      const hdfcId = 'bank_hdfc_' + Date.now();
      const sbiId = 'bank_sbi_' + Date.now();

      await execute(
        'INSERT INTO bank_accounts (id, user_id, bank_name, account_number_mask, balance, monthly_spend, monthly_credit, last_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [hdfcId, req.userId, 'HDFC Bank (Salary Account)', '••4892', 84250, 42100, 75000, now]
      );
      await execute(
        'INSERT INTO bank_accounts (id, user_id, bank_name, account_number_mask, balance, monthly_spend, monthly_credit, last_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [sbiId, req.userId, 'State Bank of India (Savings)', '••9104', 36400, 14200, 0, now]
      );

      // Seed sample real-time transactions for budget categorization
      const txs = [
        { desc: 'Salary Credited - TechCorp India', cat: 'Income', amount: 75000, type: 'credit', date: '2026-09-01' },
        { desc: 'HDFC Home Loan Auto-Debit', cat: 'Loan EMI', amount: 24500, type: 'debit', date: '2026-09-05' },
        { desc: 'ICICI Credit Card Bill Payment', cat: 'Credit Card', amount: 12400, type: 'debit', date: '2026-09-08' },
        { desc: 'Blinkit Grocery Bengaluru', cat: 'Groceries', amount: 3200, type: 'debit', date: '2026-09-12' },
        { desc: 'BESCOM Electricity Bill', cat: 'Utilities', amount: 1850, type: 'debit', date: '2026-09-15' },
        { desc: 'Swiggy Gourmet Delivery', cat: 'Dining', amount: 1450, type: 'debit', date: '2026-09-19' },
      ];

      for (const t of txs) {
        await execute(
          'INSERT INTO bank_transactions (id, user_id, account_id, description, category, amount, type, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ['tx_' + Date.now() + Math.random().toString(36).substring(2, 6), req.userId, hdfcId, t.desc, t.cat, t.amount, t.type, t.date]
        );
      }

      accounts = await queryAll('SELECT * FROM bank_accounts WHERE user_id = ?', [req.userId]);
    }

    const transactions = await queryAll(
      'SELECT * FROM bank_transactions WHERE user_id = ? ORDER BY date DESC LIMIT 20',
      [req.userId]
    );

    // Group spending by category
    const categoryTotals: Record<string, number> = {};
    for (const t of transactions) {
      if (t.type === 'debit') {
        categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
      }
    }

    return res.json({
      accounts,
      transactions,
      spending_by_category: Object.entries(categoryTotals).map(([name, value]) => ({ name, value })),
      total_balance: accounts.reduce((acc, a) => acc + a.balance, 0),
      total_monthly_spend: accounts.reduce((acc, a) => acc + a.monthly_spend, 0),
    });
  } catch (error: any) {
    console.error('Banking API error:', error);
    return res.status(500).json({ error: 'Failed to fetch banking accounts' });
  }
});

app.post('/api/banking/sync', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date().toISOString();
    await execute('UPDATE bank_accounts SET last_synced = ? WHERE user_id = ?', [now, req.userId]);
    return res.json({ message: 'Bank accounts synced successfully via Account Aggregator sandbox', synced_at: now });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to sync banking data' });
  }
});

// ======================== DASHBOARD AGGREGATE ROUTE ======================== //

app.get('/api/dashboard', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<{ id: string; name: string; email: string }>('SELECT id, name, email FROM users WHERE id = ?', [req.userId]);
    const profile = await queryOne('SELECT * FROM financial_profiles WHERE user_id = ?', [req.userId]);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not initialized' });
    }

    const metrics = calculateMetrics(
      profile.monthly_income,
      profile.monthly_debt_payment,
      profile.monthly_expenses,
      profile.outstanding_credit,
      profile.credit_limit
    );

    const history = await queryAll(
      'SELECT id, score, delta, note, recorded_at FROM credit_score_history WHERE user_id = ? ORDER BY recorded_at ASC',
      [req.userId]
    );

    const loans = await queryAll('SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC', [req.userId]);
    const missedPayments = await queryAll('SELECT * FROM missed_payments WHERE user_id = ? ORDER BY payment_date DESC LIMIT 5', [req.userId]);

    const latestRecommendation = await queryOne<{ id: string; summary: string; health_status: string; recommendations_json: string; created_at: string }>(
      'SELECT * FROM ai_recommendations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.userId]
    );

    let aiData = null;
    if (latestRecommendation) {
      try {
        aiData = {
          id: latestRecommendation.id,
          ...JSON.parse(latestRecommendation.recommendations_json),
          created_at: latestRecommendation.created_at,
        };
      } catch (e) {
        // ignore parse error
      }
    }

    const latestDelta = history.length > 1 ? history[history.length - 1].score - history[history.length - 2].score : 0;

    return res.json({
      user,
      profile: {
        ...profile,
        metrics,
        improvement_delta: latestDelta,
      },
      score_history: history,
      loans,
      missed_payments: missedPayments,
      latest_ai_analysis: aiData,
      summary_cards: {
        credit_score: profile.credit_score,
        dti: metrics.dti,
        credit_utilization: metrics.credit_utilization,
        active_loans: loans.filter(l => l.status === 'active').length,
        missed_payments: missedPayments.filter(m => m.status === 'missed').length,
        monthly_income: profile.monthly_income,
        monthly_debt: profile.monthly_debt_payment,
        outstanding_debt: profile.outstanding_credit + loans.reduce((acc, l) => acc + (l.status === 'active' ? l.outstanding_amount : 0), 0),
      },
    });
  } catch (error: any) {
    console.error('Dashboard aggregate error:', error);
    return res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

// ======================== DEMO PERSONA SEEDING ROUTE ======================== //

app.post('/api/demo/seed', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const now = new Date();

    // Set demo financial profile (Rahul Sharma, Mid-Level Tech Professional, Bengaluru)
    await execute(
      `UPDATE financial_profiles SET
        monthly_income = 85000,
        monthly_expenses = 38000,
        monthly_debt_payment = 28500,
        credit_score = 724,
        credit_limit = 200000,
        outstanding_credit = 46000,
        active_loans = 2,
        missed_payments = 0,
        financial_goal = 'Achieve 780+ CIBIL score for prime SBI Home Loan rate',
        dti = 33.5,
        credit_utilization = 23.0,
        updated_at = ?
       WHERE user_id = ?`,
      [now.toISOString(), userId]
    );

    // Clear old sample records for clean demo
    await execute('DELETE FROM credit_score_history WHERE user_id = ?', [userId]);
    await execute('DELETE FROM loans WHERE user_id = ?', [userId]);
    await execute('DELETE FROM missed_payments WHERE user_id = ?', [userId]);
    await execute('DELETE FROM ai_recommendations WHERE user_id = ?', [userId]);

    // Seed 6-month historical progression: 672 -> 685 -> 695 -> 705 -> 715 -> 724
    const historyMonths = [
      { score: 672, delta: 0, date: '2026-04-15', note: 'Initial CIR review' },
      { score: 685, delta: 13, date: '2026-05-15', note: 'Cleared overdue card balance' },
      { score: 695, delta: 10, date: '2026-06-15', note: 'Reduced utilization below 35%' },
      { score: 705, delta: 10, date: '2026-07-15', note: 'Consistent on-time auto-debit streak' },
      { score: 715, delta: 10, date: '2026-08-15', note: 'Credit limit increased by HDFC' },
      { score: 724, delta: 9, date: '2026-09-15', note: 'Low utilization & balanced credit mix' },
    ];

    for (const h of historyMonths) {
      await execute(
        'INSERT INTO credit_score_history (id, user_id, score, delta, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['csh_demo_' + h.date, userId, h.score, h.delta, h.note, h.date + 'T10:00:00Z']
      );
    }

    // Seed 2 active loans + 1 closed loan
    await execute(
      `INSERT INTO loans (id, user_id, name, type, principal, outstanding_amount, emi, interest_rate, start_date, end_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['loan_demo_1', userId, 'HDFC Car Loan (Hyundai Creta)', 'Auto Loan', 800000, 420000, 16200, 8.85, '2024-03-10', '2028-03-10', 'active', now.toISOString()]
    );
    await execute(
      `INSERT INTO loans (id, user_id, name, type, principal, outstanding_amount, emi, interest_rate, start_date, end_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['loan_demo_2', userId, 'ICICI Personal Loan (Home Renovation)', 'Personal Loan', 350000, 185000, 12300, 11.5, '2025-01-15', '2027-01-15', 'active', now.toISOString()]
    );
    await execute(
      `INSERT INTO loans (id, user_id, name, type, principal, outstanding_amount, emi, interest_rate, start_date, end_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['loan_demo_3', userId, 'SBI Two-Wheeler Loan', 'Auto Loan', 95000, 0, 0, 9.2, '2022-05-10', '2024-05-10', 'closed', now.toISOString()]
    );

    // Seed 1 resolved missed payment
    await execute(
      `INSERT INTO missed_payments (id, user_id, loan_name, amount, payment_date, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mp_demo_1', userId, 'ICICI Coral Credit Card', 4500, '2026-03-18', 'resolved', 'Delayed by 4 days due to outstation travel; resolved with NOC', now.toISOString()]
    );

    return res.json({ message: 'Demo persona seeded successfully with real Indian financial data' });
  } catch (error: any) {
    console.error('Demo seed error:', error);
    return res.status(500).json({ error: 'Failed to seed demo data' });
  }
});

// ======================== SERVER & VITE SETUP ======================== //

async function startServer() {
  await getDb(); // Initialize SQLite database

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Credit Assistant full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
