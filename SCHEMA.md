# Backend & Schema Documentation

## Overview

This app uses **Firebase Firestore** as its database (NoSQL, document-based).
There is no custom backend server — the React frontend talks directly to Firestore
via the Firebase JavaScript SDK. All reads and writes happen from the browser.

---

## Firestore Collections

```
Firestore Database
├── config/
│   ├── slots        → game slot configuration
│   └── settings     → global app settings (commission %)
│
├── sessions/
│   └── {sessionId}  → one document per person per day
│
└── payments/
    └── {paymentId}  → one document per person per game slot per day
```

---

## Collection: `config`

Small, always loaded at app startup.

### `config/slots`

Stores all 5 game slot definitions.

```json
{
  "slots": [
    {
      "id": "usa",
      "name": "USA",
      "time": "10:00",
      "emoji": "🇺🇸",
      "enabled": true
    },
    {
      "id": "india",
      "name": "India",
      "time": "14:00",
      "emoji": "🇮🇳",
      "enabled": true
    }
    // ... up to 5 slots
  ]
}
```

| Field     | Type    | Description                              |
|-----------|---------|------------------------------------------|
| `id`      | string  | Unique identifier, lowercase (e.g. `usa`) |
| `name`    | string  | Display name shown in UI                 |
| `time`    | string  | Result time in 24h format `"HH:MM"`      |
| `emoji`   | string  | Flag/emoji shown next to the slot name   |
| `enabled` | boolean | Whether this slot is active              |

**When saved:** Every time the admin changes slot settings in the Settings tab.

---

### `config/settings`

Global app settings.

```json
{
  "commissionPct": 5
}
```

| Field           | Type   | Description                                      |
|-----------------|--------|--------------------------------------------------|
| `commissionPct` | number | Admin's default commission percentage (e.g. `5`) |

**When saved:** Every time the admin changes the commission % in Settings.

---

## Collection: `sessions`

One document per **person per day**. Stores all the number bets that person
sent across all WhatsApp messages for that day.

### Document ID format
```
{contact}|{date}
```
Example: `+91 93513 40631|13__SL__04__SL__2026`

> Note: `/` in dates is replaced with `__SL__` because Firestore document IDs
> cannot contain forward slashes. The `date` field *inside* the document still
> stores the original `DD/MM/YYYY` format.

### Document structure

```json
{
  "id": "+91 93513 40631|12/04/2026",
  "contact": "+91 93513 40631",
  "date": "12/04/2026",
  "dateISO": "2026-04-12",
  "createdAt": 1744473600000,
  "messages": [
    {
      "id": "+91 93513 40631|6:16 pm",
      "timestamp": "6:16 pm",
      "text": "02,04,07,09,,,,,,,40 पलटके साथ",
      "slotId": "italy",
      "result": {
        "total": 150,
        "results": [
          {
            "line": "02,04,07,09",
            "rate": 40,
            "isWP": false,
            "isDouble": false,
            "count": 4,
            "lineTotal": 160
          }
        ]
      }
    }
    // ... more messages from this person on this day
  ]
}
```

| Field                   | Type     | Description                                               |
|-------------------------|----------|-----------------------------------------------------------|
| `id`                    | string   | `{contact}\|{date}` — unique key per person per day       |
| `contact`               | string   | WhatsApp contact name or phone number                     |
| `date`                  | string   | `DD/MM/YYYY` — used for exact-match queries               |
| `dateISO`               | string   | `YYYY-MM-DD` — used for monthly range queries             |
| `createdAt`             | number   | Unix timestamp (ms) when the session was first created    |
| `messages`              | array    | All bet messages from this person on this day             |
| `overrideResult`        | object?  | Optional manual override of the total (admin can edit)    |
| `messages[].id`         | string   | `{contact}\|{timestamp}` — unique per message             |
| `messages[].timestamp`  | string   | Original time string from WhatsApp, e.g. `"6:16 pm"`     |
| `messages[].text`       | string   | Raw bet text from the WhatsApp message                    |
| `messages[].slotId`     | string   | Which game this message belongs to (auto-detected by time)|
| `messages[].result`     | object   | Parsed calculation result for this message                |
| `messages[].result.total`   | number | Total bet amount for this message                    |
| `messages[].result.results` | array  | Line-by-line breakdown of the bet                    |

**When saved:** Every time the admin clicks "Calculate" after pasting WhatsApp messages.
If the person already has a session for that day, the new messages are merged in (no duplicates).

---

## Collection: `payments`

One document per **person per game slot per day**. Tracks how much the person
actually paid and the admin's commission.

### Document ID format
```
{contact}|{slotId}|{date}
```
Example: `+91 93513 40631|italy|13__SL__04__SL__2026`

> Same `__SL__` escaping as sessions.

### Document structure

```json
{
  "id": "+91 93513 40631|italy|12/04/2026",
  "contact": "+91 93513 40631",
  "slotId": "italy",
  "slotName": "Italy",
  "date": "12/04/2026",
  "dateISO": "2026-04-12",
  "amountPaid": 500,
  "commissionPct": 5,
  "notes": "",
  "createdAt": 1744473600000,
  "updatedAt": 1744480000000
}
```

| Field           | Type          | Description                                                        |
|-----------------|---------------|--------------------------------------------------------------------|
| `id`            | string        | `{contact}\|{slotId}\|{date}` — unique per person per slot per day |
| `contact`       | string        | WhatsApp contact name or phone number                              |
| `slotId`        | string        | Which game slot this payment is for (e.g. `"italy"`)               |
| `slotName`      | string        | Display name of the slot (e.g. `"Italy"`)                          |
| `date`          | string        | `DD/MM/YYYY`                                                       |
| `dateISO`       | string        | `YYYY-MM-DD`                                                       |
| `amountPaid`    | number\|null  | How much the person actually paid. `null` = not yet paid           |
| `commissionPct` | number?       | Commission % snapshot at time of payment. Falls back to global setting if absent |
| `notes`         | string        | Free-text notes (currently empty by default)                       |
| `createdAt`     | number        | Unix timestamp (ms) when stub was first created                    |
| `updatedAt`     | number        | Unix timestamp (ms) when payment was last updated                  |

**When created (as stub):** Automatically when "Calculate" is run. A stub is
created with `amountPaid: null` for each unique `(contact, slot, date)` combination.

**When updated:** When the admin enters the actual received amount in the Payments tab.

---

## How Data Flows

### 1. Pasting WhatsApp Messages → Calculate

```
User pastes WhatsApp chat export
        ↓
parseWhatsAppMessages()
  • Extracts contact, timestamp, raw bet text
  • Each message gets its own timestamp e.g. "6:16 pm"
        ↓
detectSlotFromTimestamp(timestamp, slots)
  • Converts timestamp to minutes (e.g. 6:16 pm = 1096 min)
  • Finds the NEXT slot whose result time is AFTER the message time
  • e.g. 6:16 pm → after Japan (6:00 PM) → assigns to Italy (10:00 PM)
        ↓
mergeIntoSessions(existing, messages)
  • Groups messages by contact + date into SavedSession documents
  • If a session already exists for that person+day, merges new messages in
        ↓
saveSessionDoc(session) × N           → Firestore: sessions/{id}
savePaymentDoc(stub)    × N           → Firestore: payments/{id}
```

### 2. Opening History Tab

```
Component mounts
        ↓
loadSessionDatesForMonth(year, month)
  • Queries: sessions WHERE dateISO >= "2026-04-01" AND dateISO <= "2026-04-31"
  • Returns list of dates that have data → calendar dots shown
  • Auto-jumps to most recent date with data
        ↓
User taps a date
        ↓
loadSessionsByDate("12/04/2026")
  • Queries: sessions WHERE date == "12/04/2026"
loadPaymentsByDate("12/04/2026")
  • Queries: payments WHERE date == "12/04/2026"
        ↓
Renders: Game Slot → Person → Bet breakdown + Received/Pending
```

### 3. Opening Payments Tab (Daily View)

```
Component mounts
        ↓
Auto-jump to most recent date (same loadSessionDatesForMonth logic)
        ↓
loadSessionsByDate(date) + loadPaymentsByDate(date)
        ↓
Renders payment cards per slot per person
  • Shows bet total, amount paid, pending, admin's commission earned
  • Admin can tap a card to enter the received amount
        ↓
savePaymentDoc(updatedPayment)      → Firestore: payments/{id}
```

### 4. Monthly View (Payments Tab)

```
loadSessionsByMonth(year, month)
  • Queries: sessions WHERE dateISO >= "2026-04-01" AND dateISO <= "2026-04-31"
loadPaymentsByMonth(year, month)
  • Same range query on payments collection
        ↓
buildMonthData() aggregates per day:
  totalBets  = sum of all bet amounts
  received   = sum of amountPaid where not null
  earned     = sum of (amountPaid × commissionPct / 100) per payment
  pending    = totalBets − received
```

---

## Firestore Query Types Used

| Query                                   | Used for                          | Index needed? |
|-----------------------------------------|-----------------------------------|---------------|
| `WHERE date == "12/04/2026"`            | Load one day's sessions/payments  | No (auto)     |
| `WHERE dateISO >= X AND dateISO <= Y`   | Load a full month                 | No (auto, single-field range) |

All indexes are **automatically managed** by Firestore — no manual index creation needed.

---

## Document ID Escaping

Firestore document IDs cannot contain `/`. Since dates are stored as `DD/MM/YYYY`,
all IDs that include a date have their slashes replaced:

```
"12/04/2026"  →  "12__SL__04__SL__2026"
```

The `date` field **inside** the document is always kept in the original `DD/MM/YYYY`
format for display and querying.

---

## App Startup Sequence

```
App loads
    ↓
useAppData hook runs
    ↓
[One-time] localStorage → Firestore migration (flag: fb_migrated_v1)
    • Copies slots & settings from localStorage into config/ docs
[One-time] Old bulk-doc → per-doc migration (flag: fb_db_migrated_v2)
    • Reads data/sessions and data/payments (old format)
    • Writes each as individual session/{id} and payments/{id} documents
    ↓
loadSlotsDB()    → config/slots
loadSettingsDB() → config/settings
    ↓ (both loaded upfront because they are tiny and always needed)
App renders — sessions & payments are loaded lazily per tab/date
```

---

## localStorage Usage

localStorage is used only for:
| Key                | Purpose                                        |
|--------------------|------------------------------------------------|
| `fb_migrated_v1`   | Flag: old localStorage data was migrated once  |
| `fb_db_migrated_v2`| Flag: old bulk Firestore format was migrated   |
| `gameSlots`        | Backup copy of slots (written on every save)   |
| `appSettings`      | Backup copy of settings (written on every save)|

Sessions and payments are **not** stored in localStorage anymore.

---

## Environment Variables

All Firebase credentials are in `.env` (not committed to git):

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

These are read in `src/firebase.ts` and used to initialise the Firestore connection.

---

## Firestore Security Rules (Current)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> **Note:** This is development-only. Anyone who knows the Firebase project ID can
> read/write data. Before sharing the app publicly, restrict these rules to
> authenticated users only.
