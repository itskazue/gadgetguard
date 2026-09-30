# 🛡️ GADGETGUARD — Setup & Run Instructions

Official Campus Asset Tracking, Device Registration, and QR Recovery System.

---

## ⚡ Quick Start for Antigravity / Terminal

Kung kaka-download o extract mo lang ng project na ito sa iyong computer, buksan ang terminal o sabihin kay **Antigravity** ang sumusunod na instruction:

### Step 1: Install Dependencies & Initialize Database
Patakbuhin ang command na ito sa root folder ng project:
```bash
npm run setup
```
> **Ano ang ginagawa nito?**
> - Inii-install ang lahat ng kailangang packages (`npm install`).
> - Awtomatikong nilalagyan ng kumpletong demo records ang database tulad ng registered devices, QR codes, audit logs, at accounts para sa College at SHS (`npm run seed`).

### Step 2: Start the Server
Patakbuhin ang command na ito:
```bash
npm start
```
Pagkatapos, buksan sa browser:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 👥 Demo Accounts (Pang-Testing)

May **1-Click Quick Login** buttons na sa login modal, pero narito ang credentials kung kailangan:

| Role | Email | Password | Access / Portal |
| :--- | :--- | :--- | :--- |
| **🏢 OSA Admin** | `osa.admin@univ.edu` | `admin123` | [http://localhost:3000/osa/](http://localhost:3000/osa/) |
| **🎓 Student (Juan)** | `juan.delacruz@student.univ.edu` | `student123` | [http://localhost:3000/student/](http://localhost:3000/student/) |
| **🎒 Student (Maria - SHS)** | `maria.santos@student.univ.edu` | `student123` | [http://localhost:3000/student/](http://localhost:3000/student/) |

---

## 🔄 Paano Mag-Reset ng Database (Fresh Start)
Kung gusto mong ibalik sa malinis na original state ang database at mga demo data:
```bash
npm run seed
```

---

## 📂 Project Structure
- `public/` — Frontend web application:
  - `index.html` & `js/public.js` — Public homepage, login, and student registration flow.
  - `student/` — Student Portal (Device management, report missing, claim requests).
  - `osa/` — OSA Director & Admin Dashboard (Approvals queue, printed QR stickers, custody & returns).
  - `device/` — Public QR scan & finder recovery landing page.
- `server/` — Express backend with real JSON file database:
  - `server.js` — Main application server & WebSocket engine.
  - `db.js` — Local persistent database engine.
  - `seed.js` — Automated database seeder.
  - `routes/` — Authentication, Gadgets, Reports, Claims, and Settings API.
- `data/` — JSON database files (`users.json`, `gadgets.json`, `audit_logs.json`, etc.).
