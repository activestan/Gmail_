# MailMorph — Smart Email Variation Generator

**Live Website:** [https://activestan.github.io/Gmail_/](https://activestan.github.io/Gmail_/)

A simple, privacy-first static website hosted on **GitHub Pages**. Type or paste email(s)—or upload a **`.pdf`**, **`.txt`**, **`.csv`**, **`.xlsx`**, **`.doc`**, or **`.docx`** file—and get instant email variations formatted for **BCC** or list export.

---

## Features

- **Multi-Format File Upload (100% Client-Side):** Supports `.pdf`, `.txt`, `.csv`, `.xlsx` / `.xls`, `.docx`, and `.doc` directly in your browser.
- **Accent & Special Letter Folding (`ç → c`):** Automatically converts accented/special characters (`ç → c`, `é → e`, `ñ → n`, `ọ → o`, `ü → u`, etc.) and fixes common domain typos (`gmial.com → gmail.com`).
- **Smart Letter, Syllable & Number Reductions:** Steps down trailing numbers/years (`2004 → 200 → 20 → 2`, `04`), syllables, and compound name parts (`Odimegwustanley2004@gmail.com` → `Odimegwu@gmail.com`, `Odimegwustan@gmail.com`, etc.).
- **Gmail Creation & Spelling Patterns:** Suggests common transpositions (`Odimegwustanely@gmail.com`), reversed name orders (`Stanleyodimegwu@gmail.com`), and initial combinations (`Odimegwus@gmail.com`, `Sodimegwu@gmail.com`) while respecting Gmail's 6–30 character rule.
- **Simple Output Format Selector:** Choose **BCC (Comma-separated)**, **BCC (Semicolon — Outlook)**, **Plain List**, or **CSV**, with one-click **Copy** and **Download**.
