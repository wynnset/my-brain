# Finance DB — Transaction Sign Convention Reference

**Last updated:** 2026-04-11  
**Author:** Ledger  
**Database:** `/Users/aidin/Documents/Websites/claude-code/my-brain/data/finance.db`

---

## The Standard Convention

> **All transaction amounts follow the cash-flow perspective of the account holder:**
> - **Positive (+)** = money arriving in or added to the account (inflow)
> - **Negative (−)** = money leaving or reducing the account (outflow)

This convention is applied consistently across ALL account types. The sign always reflects the direction of money relative to that specific account, from the account holder's point of view.

---

## Convention Table by Account Type

| Account Type | Positive (+) means | Negative (−) means | Real-world example |
|---|---|---|---|
| **chequing** | Deposit, e-transfer in, payroll, refund received | Withdrawal, payment sent, purchase, fee | +$3,467 payroll deposit (RBC CHQ); −$3,098 mortgage payment (TD CHQ) |
| **credit_card** | Payment received (reduces balance owed), credit/refund | Purchase charged (increases balance owed) | +$2,222.47 payment (RBC Visa txn 2408); −$40.09 grocery purchase |
| **loc** (line of credit) | Draw taken from the LOC (money received into your hands) | Payment made to reduce the LOC balance | +$25,000 Scotia LOC draw (txn 3127); −$512.89 LOC payment (txn 3107) |
| **loc** (HELOC) | Draw taken from HELOC (money received); also interest charged | Payment made to reduce HELOC balance | +$3,540 HELOC draw (txn 3138); −$35.64 payment from TD CHQ (txn 3007) |
| **mortgage** | (none seen — mortgages only have outflows recorded) | Regular mortgage payment (principal + interest) | −$3,098.44 primary mortgage payment (txn 3009) |
| **savings** | Deposit, transfer in | Withdrawal | (no savings accounts yet in the DB) |

---

## Detailed Evidence by Account

### Chequing Accounts (IDs 1, 2, 3)

| Txn | Account | Amount | Description | Interpretation |
|---|---|---|---|---|
| — | RBC CHQ (1) | +$3,467 | PAYROLL DEPOSIT | Income received — correct positive |
| 388 | RBC CHQ (1) | −$2,600 | E-TRANSFER SENT | Money sent out — correct negative |
| 397 | RBC CHQ (1) | −$6,000 | ONLINE BANKING PAYMENT - VISA TD BANK | Payment to TD Visa — correct negative |
| 399 | RBC CHQ (1) | +$6,000 | ONLINE TRANSFER RECEIVED - WYNNSET INC. | Transfer received from Wynnset — correct positive |
| 3035 | TD CHQ (2) | −$3,098.44 | LN PYMT 322671901 | Primary mortgage payment out — correct negative |
| 3038 | TD CHQ (2) | +$1,465 | E-TRANSFER ***qnt | E-transfer received — correct positive |
| 2923 | Wynnset CHQ (3) | +$11,000 | Online Banking transfer - 5127 | Transfer in from Wynnset LOC draw — correct positive |
| 2941 | Wynnset CHQ (3) | −$6,000 | Online transfer sent - Aidin Niavarani | Transfer out to Aidin — correct negative |

**Convention:** Standard bank statement convention. Matches what you see on your online banking screen.

---

### Credit Cards (IDs 4, 5, 7)

| Txn | Account | Amount | Description | Interpretation |
|---|---|---|---|---|
| 2408 | RBC Visa (4) | +$2,222.47 | PAYMENT - THANK YOU | Payment received, reduces what you owe — correct positive |
| 1968 | RBC Visa (4) | +$6,000 | TD CANADA TRUST TORONTO | Balance transfer received from TD — correct positive |
| 2031 | RBC Visa (4) | +$4,000 | TD CANADA TRUST TORONTO | Balance transfer received from TD — correct positive |
| typical | RBC Visa (4) | −$X.XX | Any purchase | Spending — correct negative |
| 3105 | TD Visa (7) | +$9,600 | BALANCE TRANSFER - RBC DEBT | Balance transfer funds received — correct positive |
| 3137 | TD Visa (7) | −$3,540 | TD HELOC draw → TD Visa payoff | Payoff payment received (reduces balance) — **see note** |

**Note on txn 3137 (TD Visa, −$3,540):** This transaction was entered as negative on the TD Visa side, meaning it is recorded as a charge/outflow rather than a payment. However, paying off a credit card balance should appear as **positive** on the card (payment reducing the balance owed). This is a likely sign error — see Flags section below.

**Convention:** Positive = payment/credit (you owe less). Negative = purchase/charge (you owe more). This is the **inverse of your bank statement** if your statement shows purchases as positive debits — but in this DB, the cash-flow-from-your-wallet perspective means purchases are negative.

---

### Lines of Credit — Scotia LOC (ID 10)

| Txn | Account | Amount | Description | Interpretation |
|---|---|---|---|---|
| 3127 | Scotia LOC (10) | +$25,000 | scotiabank richmond bc | Initial LOC draw — money received, correct positive |
| 3125 | Scotia LOC (10) | +$2,840 | to - *****20328142015 | Funds drawn from LOC to another account — correct positive |
| 3109 | Scotia LOC (10) | +$231.14 | interest charges-cash | **Interest charged** — POSITIVE (see note below) |
| 3112 | Scotia LOC (10) | −$518.08 | royal bank of canada | Payment to reduce balance — correct negative |

**Note on interest charges:** Interest charged on the Scotia LOC is recorded as **positive**. This is consistent with treating interest as a draw (it increases the outstanding balance, i.e., more money is "added" to the amount owed to you from the LOC's perspective). Some agents may find this counterintuitive — interest is an expense, but since it increases the LOC balance, it follows the same sign as a draw. This is consistent and intentional.

**Pair (Scotia LOC + RBC CHQ, June 2025):** The $25,000 draw (txn 3127) is paired with txn 247 (+$25,000 on RBC CHQ, dated July 10 — likely a posting lag). Both positive on their respective accounts. Correct.

---

### Lines of Credit — TD HELOC (ID 12)

| Txn | Account | Amount | Description | Interpretation |
|---|---|---|---|---|
| 3007 | TD HELOC (12) | −$35.64 | PYT FRM: 96386143165 | Payment from TD CHQ reduces HELOC balance — correct negative |
| 3008 | TD HELOC (12) | +$39.46 | INTEREST | Interest charged, increases balance owed — correct positive |
| 3134 | TD HELOC (12) | −$39.46 | INTEREST | **DUPLICATE — WRONG SIGN** — see Flags section |
| 3138 | TD HELOC (12) | +$3,540 | TD HELOC draw → TD Visa payoff | Draw taken from HELOC — correct positive |

---

### Lines of Credit — Wynnset RBC LOC (ID 9)

| Txn | Account | Amount | Description | Interpretation |
|---|---|---|---|---|
| 2941 | Wynnset LOC (9) | −$11,000 | WWW TFR VIN0-05127 | Funds drawn from LOC, sent to Wynnset CHQ — **see note** |
| 2942 | Wynnset LOC (9) | +$4,500 | PAYMENT | Payment received to reduce LOC balance — correct positive |

**Note on txn 2941 (Wynnset LOC, −$11,000):** The draw from the LOC went to Wynnset CHQ (txn 2923, +$11,000). In the Scotia LOC, a draw is recorded as positive. Here the Wynnset LOC records it as negative. This is an **inconsistency between LOC accounts.** The Wynnset LOC may have been imported from a bank statement where draws appear as negative (outflow from the credit facility). Both can be logically justified, but they are not consistent with each other. This should be clarified and standardized.

---

### Mortgages (IDs 13, 14)

| Txn | Account | Amount | Description | Interpretation |
|---|---|---|---|---|
| 3009 | Primary Mortgage (13) | −$3,098.44 | LN PYMT 322671901 | Monthly mortgage payment out — correct negative |
| 3010 | Second Mortgage (14) | −$417.71 | LN PYMT 322671902 | Monthly mortgage payment out — correct negative |

**Convention:** Only outflows recorded. Negative = payment made. No "draws" on a mortgage; the initial balance is not currently modelled as a transaction. Consistent.

---

## Summary of the Standard Convention

```
chequing:      +deposit / +transfer in    |  −payment / −withdrawal / −fee
credit_card:   +payment / +credit         |  −purchase / −charge / −fee
loc (general): +draw (money received)     |  −payment (balance reduced)
               +interest charged          |
mortgage:      (no positive flows)        |  −monthly payment
```

**The convention is internally consistent across chequing and credit_card accounts, and mostly consistent across LOC accounts, with one structural exception (Wynnset LOC, see flags).**

---

## Flags — Transactions Requiring Review

Any agent inserting transactions should verify sign direction before insert. The following transactions appear to have potential sign errors or ambiguities:

### FLAG 1 — PROBABLE DUPLICATE (DELETE one)
| Txn ID | Account | Date | Amount | Issue |
|---|---|---|---|---|
| **3008** | TD HELOC (12) | 2026-03-31 | +$39.46 | Interest charge — **reviewed, noted, CORRECT** |
| **3134** | TD HELOC (12) | 2026-03-31 | −$39.46 | Same description, same date, opposite sign — imported from CSV (batch 23, `td-heloc-mar2026.csv`) after original was already entered from PDF statement (batch 14, `td-heloc-statement.pdf`). This is a **duplicate with incorrect sign**. |

**Recommendation:** Delete txn **3134**. The correct entry is txn 3008 (+$39.46). The CSV may sign interest as negative (expense perspective) while the PDF was manually entered as positive (balance-increase perspective). Either way, only one record should exist. Adopt the positive convention (+$39.46) per the DB standard.

---

### FLAG 2 — POSSIBLE SIGN ERROR (or intentional)
| Txn ID | Account | Date | Amount | Issue |
|---|---|---|---|---|
| **3137** | TD Visa (7) | 2026-04-11 | −$3,540 | Recorded as negative on TD Visa. The note says "TD Visa promo balance paid off." A payment to a credit card should reduce the balance owed, which under the DB convention should be **positive** on the credit card. Paired with txn 3138 (+$3,540 on HELOC), which is correct. |

**Recommendation:** Review whether this was intentionally entered as negative (treating the payoff as a debit/charge flow from the credit card's perspective) or if it should be +$3,540. The transfer pair with HELOC (3138) suggests the HELOC side is correct; the TD Visa side may need to be corrected to +$3,540.

---

### FLAG 3 — LOC SIGN INCONSISTENCY (Convention mismatch)
| Txn ID | Account | Date | Amount | Issue |
|---|---|---|---|---|
| **2941** | Wynnset LOC (9) | 2026-03-25 | −$11,000 | A draw from the LOC (money sent to Wynnset CHQ). Under the DB convention for LOC accounts, a draw should be **positive** (money received/disbursed from the facility). The paired txn 2923 on Wynnset CHQ is +$11,000, which is correct. |

**Recommendation:** Consider whether to re-sign txn 2941 to +$11,000 on the Wynnset LOC, consistent with the Scotia LOC convention (+draws, −payments). This affects how the LOC balance is calculated. Confirm with Aidin before changing.

---

### FLAG 4 — TD Visa +$6,000 (Mar 24, 2026, txn 3135)
| Txn ID | Account | Date | Amount | Issue |
|---|---|---|---|---|
| **3135** | TD Visa (7) | 2026-03-24 | +$6,000 | Source: "ROYAL BANK OF CANADA". Not marked as reviewed. Not marked as is_transfer. |

**Observation:** This appears to be a payment or balance transfer received on the TD Visa from RBC. The paired transaction on RBC CHQ side is txn 397 (−$6,000 on RBC CHQ, "ONLINE BANKING PAYMENT - VISA TD BANK", is_transfer=1). The TD Visa side (txn 3135) is **not** marked is_transfer=1 and has no notes. Sign (+) is correct for a payment received. **Action needed:** Mark txn 3135 as is_transfer=1 and add a note; link transfer_pair_id to txn 397.

---

## Agent Checklist — Before Inserting a Transaction

1. Identify the account type (chequing / credit_card / loc / mortgage).
2. Apply the sign:
   - **Chequing:** Is money entering the account? → positive. Leaving? → negative.
   - **Credit card:** Is this a purchase/charge? → negative. Is this a payment/refund? → positive.
   - **LOC:** Is this a draw (funds disbursed to you)? → positive. Is this a payment or fee? → positive if it increases balance, negative if it reduces balance. **Interest = positive** (increases balance owed).
   - **Mortgage:** All recorded flows are payments out → negative.
3. If it's a transfer between two accounts, set is_transfer=1 on both sides and link transfer_pair_id.
4. Check for existing transactions with the same (account_id, date, amount, description_raw) — the UNIQUE constraint will reject duplicates, but verify the sign is correct before the import.
5. If importing from CSV, confirm the CSV's sign convention and invert if necessary so the DB convention is maintained.
