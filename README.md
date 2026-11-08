# MailMorph — Email Reduction Generator

**Live Website:** [https://activestan.github.io/Gmail_/](https://activestan.github.io/Gmail_/)

A fast, simple static website hosted on **GitHub Pages**. Type or paste email(s)—or upload a **`.pdf`**, **`.txt`**, **`.csv`**, **`.xlsx`**, **`.doc`**, or **`.docx`** file—and generate clean progressive email reductions formatted for **BCC** or list export.

---

## How It Works

1. **Accent & Special Letter Cleanup (`ç → c`):** Automatically converts accented letters (`ç → c`, `é → e`, `ñ → n`, `ọ → o`, etc.) before reducing.
2. **Progressive Character/Symbol Reduction Down to 3 Letters:** Removes one letter, number, or symbol at a time from right to left until 3 characters remain, then moves on to the next email in your list.
3. **Under 10 Variations per Email:** Each email produces at most **9** clean variations (automatically stepping cleanly across syllable/number boundaries on longer addresses).
4. **Multi-Format Upload & Export:** Accepts `.pdf`, `.txt`, `.csv`, `.xlsx`, `.doc`, and `.docx` privately in the browser, and outputs in **BCC (Comma-separated)**, **BCC (Semicolon — Outlook)**, **Plain List**, or **CSV**.
