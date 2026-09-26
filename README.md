# Credit Assistant — AI-Powered Credit Health Platform

> **Understand Your Credit. Improve Your Financial Health.**

Credit Assistant is a full-stack financial technology application tailored for the **Indian credit ecosystem**. It empowers users to monitor their CIBIL/Experian credit score progression, analyze Debt-to-Income (DTI) and revolving credit card utilization, optimize debt payoffs via the Avalanche and Snowball methods, simulate credit actions, and receive personalized educational roadmaps powered by **Google Gemini AI**.

---

## 1. Primary Features

- **CIBIL Score Health Dashboard**: Visual score gauge (300 to 900 benchmark range), status tiers (Prime 750+, Good 700-749, Fair 650-699, Needs Attention), and delta progress tracking.
- **Financial Ratios & Health Metrics**:
  - **Debt-to-Income (DTI)**: $\text{DTI} = \frac{\text{Monthly Debt Payments}}{\text{Gross Monthly Income}} \times 100$
  - **Credit Card Utilization**: $\text{Utilization} = \frac{\text{Outstanding Revolving Balance}}{\text{Available Credit Limit}} \times 100$
  - **Monthly Liquidity Surplus**: Income minus living expenses and debt payments.
- **Historical Credit Score Chart**: Interactive time-series line chart (Recharts) with benchmark reference lines and delta tooltips.
- **Revolving Credit Utilization Chart**: Donut chart tracking used vs. available credit limits with bureau safety guidelines (under 30%).
- **Gemini AI Financial Advisor**:
  - Deep analysis of the user's financial profile.
  - Phased **5-Step Improvement Roadmap**:
    1. *Step 1: Immediate Priority* (addressing delinquencies/DPD)
    2. *Step 2: Debt Management* (avalanche vs. snowball payoff)
    3. *Step 3: Credit Utilization* (billing cycle timing and balance paydown)
    4. *Step 4: Payment Discipline* (NACH auto-debit and buffer accounts)
    5. *Step 5: Long-Term Credit Health* (credit age and account mix)
- **Credit Score Simulator**:
  - Real-time simulation of actions: paying down card debt, requesting credit limit hikes, taking new personal loans, missing an EMI payment, or maintaining consecutive on-time payment streaks.
  - Projected score with 4-factor breakdown (Payment History, Utilization, Credit Mix, Inquiries).
- **Personalized Debt Payoff Engine**:
  - Side-by-side comparison of **Debt Avalanche** (mathematically minimizes interest paid) vs. **Debt Snowball** (quick psychological momentum).
  - Dynamic monthly extra payment allocation slider with exact month-by-month debt-free dates.
- **Real-Time Banking & Budget Sync (Sandbox)**:
  - RBI Account Aggregator simulation with Indian banks (HDFC Bank, State Bank of India, ICICI Bank).
  - Live account liquidity and budget categorization (EMIs, Groceries, Utilities, Dining, Shopping).
- **Loan Tracking & Delinquency Monitor**:
  - Add, edit, and track personal, auto, home, and education loans with principal, outstanding balance, EMI, and interest rates.
  - Missed payment tracking with Days Past Due (DPD) education and No Dues Certificate (NOC) guidelines.
- **Credit Advisory Chatbot**:
  - Interactive AI assistant answering questions on CIBIL vs Experian, loan settlement pitfalls, credit bureau dispute filings with the RBI ombudsman, and credit card limit strategies.
- **One-Click Demo Persona**:
  - Instant pre-loaded profile for *Rahul Sharma* (Bengaluru, 724 CIBIL score, 2 active loans, 6 months historical progression) for evaluation.

---

## 2. Technology Stack

### Frontend
- **React 19** + **TypeScript**
- **Vite**
- **Tailwind CSS v4**
- **Recharts** for responsive charts
- **Lucide React** for icons

### Backend & AI
- **Express.js / Node.js** (Production full-stack dev server mounting Vite)
- **FastAPI / Python** alternative backend in `backend/` with SQLAlchemy & Pydantic
- **SQLite** database (`credit_assistant.db`)
- **Google Gemini API** (`@google/genai` TypeScript SDK, model `gemini-3.8-flash`)
- **JWT (JSON Web Token)** for stateless authentication
- **Bcrypt** for password hashing

---

## 3. Project Structure

```
├── backend/                        # Python FastAPI backend architecture
│   ├── app/
│   │   ├── main.py                 # FastAPI application and endpoints
│   │   ├── database.py             # SQLAlchemy engine and session setup
│   │   ├── models/models.py        # User, FinancialProfile, Loan, AIRecommendation models
│   │   ├── schemas/schemas.py      # Pydantic validation schemas
│   │   └── auth/auth.py            # JWT token creation and password hashing
│   ├── requirements.txt            # Python dependencies
│   ├── .env.example                # FastAPI environment template
│   └── tests/test_backend.py       # Unit tests for calculations & scoring
│
├── server/                         # Node.js server engine
│   ├── db.ts                       # SQLite database wrapper
│   ├── gemini.ts                   # Gemini AI financial analysis & chatbot
│   └── financial_engine.ts         # Deterministic calculations, simulator, and debt payoff
│
├── src/                            # React Frontend
│   ├── components/
│   │   ├── Navbar.tsx              # Navigation header with demo switch & tabs
│   │   ├── LandingPage.tsx         # Public marketing page with login & register
│   │   ├── ScoreGauge.tsx          # CIBIL score radial gauge
│   │   ├── FinancialHealthCard.tsx # Metric cards (DTI, Utilization, Loans)
│   │   ├── CreditScoreChart.tsx    # Recharts score history line chart
│   │   ├── UtilizationChart.tsx    # Recharts credit card donut chart
│   │   ├── AIAdvisorPanel.tsx      # 5-step roadmap & Gemini recommendations
│   │   ├── DebtPayoffSection.tsx   # Avalanche vs Snowball calculator
│   │   ├── BankingBudgetSection.tsx# Simulated Open Banking / budget tracking
│   │   ├── LoanManagementSection.tsx# Loans table and add/edit modal
│   │   ├── MissedPaymentsSection.tsx# Delinquency monitor & DPD educational guidance
│   │   ├── ScoreSimulatorModal.tsx # Interactive credit score simulator
│   │   ├── ProfileEditorModal.tsx  # Financial profile update form
│   │   ├── LogScoreModal.tsx       # Rapid monthly score logging
│   │   └── CreditChatbotDrawer.tsx # Gemini AI credit chatbot
│   ├── services/
│   │   └── api.ts                  # Centralized typed API service layer
│   ├── App.tsx                     # Primary application coordinator
│   ├── main.tsx                    # React DOM entry point
│   └── index.css                   # Global styles & Tailwind CSS
│
├── server.ts                       # Full-stack server entrypoint
├── package.json                    # Node dependencies and scripts
└── README.md                       # Project documentation
```

---

## 4. Setup & Running the Application

### Option A: Full-Stack Node Server (Default in AI Studio)

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Create `.env`:
   ```bash
   GEMINI_API_KEY="your-gemini-api-key"
   PORT=3000
   SECRET_KEY="your-jwt-secret"
   ```

3. **Start the application**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

---

### Option B: FastAPI Backend

1. **Navigate to backend and create virtual environment**:
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install requirements**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Start FastAPI**:
   ```bash
   uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
   Interactive OpenAPI documentation is available at `http://localhost:8000/docs`.

4. **Run tests**:
   ```bash
   pytest backend/tests/test_backend.py
   ```

---

## 5. Security & Privacy Notes

- **No Hardcoded Secrets**: Gemini API keys and JWT secrets are read strictly from server environment variables and never exposed to the frontend.
- **Password Protection**: Passwords are encrypted using salted bcrypt hashes.
- **Isolated User Storage**: Database queries enforce user ID checks (`WHERE user_id = ?`).
- **No Spam Guarantee**: The platform is built as an educational decision-support tool. It does not sell user data to credit telemarketers or third-party lenders.

---

## 6. Educational Disclaimer

*Credit Assistant provides educational information and decision-support. It does not guarantee specific credit-score changes and is not a substitute for advice from qualified financial professionals, certified financial planners, or official credit bureau reports (TransUnion CIBIL, Experian, CRIF High Mark, Equifax).*
