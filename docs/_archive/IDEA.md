# Project Brief: DermaCast AI

> **Tagline:** Predictive Skincare Trajectory Engine powered by YouCam Skin AI & Skin Simulation APIs.

---

## 1. Executive Summary

**DermaCast AI** is a predictive skincare analytics platform that turns daily standardized face scans into a mathematically grounded forecast of a user's skin trajectory.

Over 70% of consumers abandon new skincare routines within 14 days because human vision cannot perceive 1% daily micro-improvements in skin barrier recovery, scar remodeling, or inflammation reduction. This lag between application and visible results causes consumers to waste money switching products prematurely and causes skincare brands to lose subscription retention.

DermaCast AI solves this drop-off by tracking daily micro-deltas, fitting a time-series regression model to the user's biological progress, and feeding the forecasted metrics directly into the **YouCam AI Skin Simulation API**. The result is a realistic, non-fake visual projection of what the user's face will look like 14, 30, or 60 days into the future if they adhere to their current routine.

---

## 2. Problem Statement & Market Opportunity

- **The Problem:** Cellular skin turnover takes 28+ days. Because daily progress is subtle, users experience "efficacy uncertainty"—guessing whether a $50 eye cream or retinol serum is working.
- **The Flaw of Existing Apps:** Current beauty apps either act as passive logbooks (drawing static line graphs) or rely on generic AI blur filters that erase face identity and create consumer skepticism.
- **The Solution:** A predictive "weather forecast" for your skin that uses your actual historical rate of improvement to mathematically drive the parameters of YouCam's dermatologist-validated simulation engine.

---

## 3. Core Features & User Workflow

### A. Guided Camera HUD & Exposure Alignment

- **Issue Addressed:** Variations in room lighting or face distance distort raw computer vision scores.
- **Feature:** An AR alignment overlay (translucent "ghost frame" of the baseline photo) + real-time face quality and lighting check (`position`, `frontal`, `lighting`) ensures 100% standardized daily photo capture.

### B. Daily Micro-Delta Skin Analysis

- Captures daily selfies and extracts 14+ granular skin metrics via the **YouCam Skin Analysis API** (acne, texture, redness, dark circles, eye bags, pores, wrinkles).
- Stores structured metric JSON vectors timestamped per day.

### C. Predictive Regression Engine

- Runs a time-series linear regression algorithm ($y = mx + b$) across historical data points ($N \ge 7\text{--}14$ days) to calculate the user's individual recovery slope $m$.
- Calculates target metric scores $y_{\text{future}}$ for $t + 14$, $t + 30$, and $t + 60$ days.
- Generates two branching paths:
    1. **Adherence Trajectory:** Sustained rate of improvement.
    2. **Abandonment Trajectory:** Projected relapse velocity back to baseline.

### D. Interactive Future Face Forecast Slider

- Translates forecasted metric deltas into normalized intensity parameters ($0.0\text{--}1.0$).
- Calls the **YouCam AI Skin Simulation API** to dynamically render the user's future face at +14, +30, and +60 days.
- Allows the user to scrub back and forth through time to visually verify their expected progress.

---

## 4. Technical Architecture & Data Pipeline

┌────────────────────────────────────────────────────────┐
│ React / Next.js Web App │
│ - Camera HUD Alignment Overlay (JS Camera Kit) │
│ - Historical Trend Charts (Recharts / Chart.js) │
│ - Interactive Forecast Slider (+14d / +30d / +60d) │
└───────────────────────────┬────────────────────────────┘
│
▼
┌────────────────────────────────────────────────────────┐
│ Backend API Router │
│ (Node.js / Express) │
└──────┬────────────────────┬────────────────────┬───────┘
│ │ │
▼ ▼ ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ YouCam API │ │ Time-Series │ │ YouCam API │
│Skin Analysis │ ──► │ Regression │ ──► │ Skin │
│ (v1.0 REST) │ │ Engine (Math)│ │ Simulation │
└──────────────┘ └──────────────┘ └──────────────┘

### Mathematical Formula (Linear Regression)

For each skin metric $y$ over elapsed time $x$ (days):
$$\text{Slope } m = \frac{N\sum(xy) - \sum x \sum y}{N\sum(x^2) - (\sum x)^2}$$
$$\text{Forecasted Score } y_{\text{future}} = m \cdot x_{\text{target}} + b$$

The computed delta $y_{\text{future}}$ is mapped to YouCam Simulation intensity inputs ($0.0\text{--}1.0$).

---

## 5. YouCam API Integration Details

1. **YouCam Skin Analysis API (`/s2s/v1.0/task/skin-analysis`)**:
    - **Role:** Diagnostic intake engine.
    - **Payload Used:** Parses structured JSON response for `acne`, `redness`, `texture`, `dark_circles`, `eye_bags`, and `wrinkles`.
2. **YouCam AI Skin Simulation API (`/s2s/v2.0/task/skin-simulation`)**:
    - **Role:** Predictive visual generator.
    - **Payload Used:** Accepts input face image + dynamic simulation intensity float values ($0.0\text{--}1.0$) derived from the regression model for targeted skin concerns.

---

## 6. Retail & Consumer Impact

- **Consumer Value:** Eliminates frustration and guesswork, giving users immediate visual motivation to stick with their routine long before changes are obvious in the mirror.
- **Retail / E-Commerce Value:** Increases customer lifetime value (LTV) and reduces product returns by proving product efficacy and keeping users compliant with multi-step skincare regimens.

---

## 7. Submission Checklist & Deliverables

- [ ] **Code Repository:** Public GitHub repository containing full source code, MIT license, and setup instructions.
- [ ] **YouCam API Credentials:** Integrated using Perfect Corp API key.
- [ ] **Pre-seeded Dataset:** 14-day sample photo/JSON trajectory dataset for instant judging demonstration.
- [ ] **Video Demo:** 1–3 minute YouTube walkthrough showing end-to-end photo capture, linear regression charting, forecast slider manipulation, and API code walkthrough.
- [ ] **Exit Interview & Blog Consent:** Agreed.
