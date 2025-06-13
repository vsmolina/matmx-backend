const nodemailer = require('nodemailer');

// You can set these via .env
const transporter = nodemailer.createTransport({
  service: 'gmail', // or another email service
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Dummy email generator — you can replace with PDF attachments later
async function sendQuoteEmail(quote, items) {
  const to = 'customer@example.com'; // Replace with quote.customer_email
  const subject = `Quote #${quote.id} from MatMX`;
  const itemList = items.map(item => `- ${item.quantity} x Product ${item.product_id}`).join('\n');

  const text = `
    Hello,

    Please find below your quote:

    Quote ID: ${quote.id}
    Rep: ${quote.rep_id}
    Total: $${quote.total}

    Items:
    ${itemList}

    Thank you,
    MatMX
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    text
  });
}

module.exports = {
  sendQuoteEmail
};
