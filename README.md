# MailMorph — Email Character Reduction Generator

**Live Website:** [https://activestan.github.io/Gmail_/](https://activestan.github.io/Gmail_/)

A fast, simple static website hosted on **GitHub Pages**. Type or paste email(s)—or upload a **`.pdf`**, **`.txt`**, **`.csv`**, **`.xlsx`**, **`.doc`**, or **`.docx`** file—and generate progressive email reductions formatted for **BCC** or list export.

---

## How It Works

1. **Accent & Special Letter Cleanup (`ç → c`):** Automatically converts accented letters (`ç → c`, `é → e`, `ñ → n`, `ọ → o`, etc.) first.
2. **1-Character-at-a-Time Reduction Down to 2 Characters:** Removes one character (letter, number, or symbol) at a time from right to left until **2 characters** remain, then moves on to the next email.
3. **Multi-Format Upload & Export:** Accepts `.pdf`, `.txt`, `.csv`, `.xlsx`, `.doc`, and `.docx` privately in the browser, and outputs in **BCC (Comma-separated)**, **BCC (Semicolon — Outlook)**, **Plain List**, or **CSV**.
