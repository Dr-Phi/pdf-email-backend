require('dotenv').config();

const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// ==================== GOOGLE SHEETS SETUP ====================
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    project_id: process.env.GOOGLE_PROJECT_ID
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const SHEET_ID = "1UXPDwLhGpS3Zs0iu0mKu2jaxTc_jeMZI7QVxSi0XYjc"

// ==================== EMAIL SETUP ====================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

// ==================== SPAM PREVENTION SETUP ====================
const recentEmails = new Map(); // store email -> timestamp
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// ==================== MAIN ROUTE ====================
app.post('/api/send-pdf', async (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).send('Missing name or email');
  }

  // === Prevent duplicate submissions ===
  const now = Date.now();
  const lastTime = recentEmails.get(email);

  if (lastTime && now - lastTime < COOLDOWN_MS) {
    console.log(`Duplicate submission from ${email} blocked.`);
    return res.status(429).send("Please wait before submitting again.");
  }

  recentEmails.set(email, now);

  // Clean up old entries
  for (let [key, time] of recentEmails.entries()) {
    if (now - time > COOLDOWN_MS) {
      recentEmails.delete(key);
    }
  }

  // ========== 1. Send the email ==========
  const mailOptions = {
    from: `"Muy Bien Español" <${process.env.MAIL_USER}>`,
    to: email,
    subject: '🎁 Your Free Spanish PDF Guide',
    text: `Hola ${name},\n\nAquí tienes tu guía para aprender español. ¡Gracias por unirte!\n\nUn abrazo,\nMuy Bien Español`,
    attachments: [
      {
        filename: 'spanish-guide.pdf',
        path: path.join(__dirname, 'pdf/spanish-guide.pdf')
      }
    ]
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${email}`);
  } catch (err) {
    console.error("Email sending failed:", err);
    return res.status(500).send("Email error");
  }

  // ========== 2. Save to Google Sheet ==========
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const today = new Date().toISOString().split('T')[0];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'A1:C1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[name, email, today]]
      }
    });

    console.log(`Saved lead: ${name} <${email}>`);

    return res.sendStatus(200);

  } catch (err) {
    console.error("Google Sheets write failed:", err);
    return res.status(500).send("Sheet error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
