const { Telegraf } = require("telegraf");
const fs = require("fs");
const cron = require("node-cron");
const express = require("express");
const PDFDocument = require("pdfkit");

const BOT_TOKEN = process.env.BOT_TOKEN; // Use the BOT_TOKEN from .env
const CHAT_ID = process.env.CHAT_ID; // Use the CHAT_ID from .env
const bot = new Telegraf(BOT_TOKEN);
const app = express();

const loadData = (chatId) => {
  let data;
  try {
    // Load all the data from the JSON file
    data = JSON.parse(fs.readFileSync("data.json", "utf8"));
  } catch (error) {
    // If the file is empty or doesn't exist, initialize an empty object
    data = {};
  }

  // If the specific user doesn't exist in the data file, create an empty entry for them
  if (!data[chatId]) {
    data[chatId] = { balance: 0, interestEarned: 0, transactions: [] };
    saveData(data); // Save the updated data structure with the new user entry
  }

  return data; // Return the entire data object (which includes all users)
};

const saveData = (data) => {
  // Save the complete data (which includes all users) back to the JSON file
  fs.writeFileSync("data.json", JSON.stringify(data, null, 2));
};

bot.start((ctx) =>
  ctx.reply("Welcome! Use /deposit <amount> or /withdraw <amount>.")
);
bot.command("help", (ctx) => {
  ctx.reply(
    "How to use this bot. \n  /deposit <amount> - to deposit \n /withdraw <amount> - to withdraw \n /statement_pdf - to get mini statement \n /balance - to check the balance"
  );
});

bot.command("about", (ctx) => {
  ctx.reply(
    "this bot is developed by @aminadam_solomon /n check him on github https://github.com/amenadam"
  );
});
bot.command("deposit", (ctx) => {
  let chatId = ctx.chat.id;
  let amount = parseFloat(ctx.message.text.split(" ")[1]);
  if (isNaN(amount) || amount <= 0) return ctx.reply("Invalid deposit amount.");

  let data = loadData(chatId); // Load all users data
  data[chatId].balance += amount;
  data[chatId].transactions.push({
    type: "Deposit",
    amount,
    date: new Date().toISOString(),
  });
  saveData(data); // Save the complete data back to the file
  ctx.reply(`Deposited $${amount}. New balance: $${data[chatId].balance}`);
});

bot.command("withdraw", (ctx) => {
  let chatId = ctx.chat.id;
  let amount = parseFloat(ctx.message.text.split(" ")[1]);
  if (isNaN(amount) || amount <= 0)
    return ctx.reply("Invalid withdrawal amount.");

  let data = loadData(chatId); // Load all users data
  if (amount > data[chatId].balance) return ctx.reply("Insufficient funds.");

  data[chatId].balance -= amount;
  data[chatId].transactions.push({
    type: "Withdrawal",
    amount,
    date: new Date().toISOString(),
  });
  saveData(data); // Save the complete data back to the file
  ctx.reply(`Withdrew $${amount}. New balance: $${data[chatId].balance}`);
});

bot.command("balance", (ctx) => {
  let chatId = ctx.chat.id;
  let data = loadData(chatId); // Load all users data
  ctx.reply(
    `Balance: $${data[chatId].balance}\nTotal Interest Earned: $${data[
      chatId
    ].interestEarned.toFixed(2)}`
  );
});

// Random waiting messages with progress percentage
const waitingMessages = [
  "Please wait while we prepare your mini statement...",
  "Generating your statement... This may take a moment.",
  "Hang tight! Your mini statement is on the way.",
  "Just a moment! We're getting your mini statement ready.",
];

const getRandomWaitingMessage = () => {
  const randomIndex = Math.floor(Math.random() * waitingMessages.length);
  return waitingMessages[randomIndex];
};

bot.command("statement_pdf", async (ctx) => {
  let chatId = ctx.chat.id;
  let data = loadData(chatId); // Load all users data

  // Get the username of the user (if available)
  let username = ctx.chat.username ? `@${ctx.chat.username}` : "No Username";

  // Send a random waiting message
  const waitingMessage = await ctx.reply(getRandomWaitingMessage());

  // Simulate a process with intervals (progress percentage)
  let progress = 0;
  const updateProgress = setInterval(() => {
    if (progress < 100) {
      progress += 10;
      const progressMessage = `${
        waitingMessages[Math.floor(Math.random() * waitingMessages.length)]
      } ${progress}% completed...`;
      bot.telegram.editMessageText(
        waitingMessage.chat.id,
        waitingMessage.message_id,
        null,
        progressMessage
      );
    } else {
      clearInterval(updateProgress);
    }
  }, 1000); // Update every 1 second

  // Generate the PDF
  const doc = new PDFDocument();
  const filePath = `mini_statement_${chatId}.pdf`; // Use chatId for unique file names

  // Pipe the PDF into a file
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  doc.fontSize(18).text("Mini Statement", { align: "center" });
  doc.fontSize(12).text(`Username: ${username}`, { align: "left" }); // Add the username
  doc
    .fontSize(12)
    .text(`Balance: $${data[chatId].balance.toFixed(2)}`, { align: "left" });
  doc.text(
    `Total Interest Earned: $${data[chatId].interestEarned.toFixed(2)}`,
    {
      align: "left",
    }
  );

  // Table Header
  doc.text("\nTransactions:", { underline: true });
  doc.text("------------------------------------------------------------", 50);

  // Draw table header
  doc.text("Date", 50, doc.y + 10);
  doc.text("Type", 250, doc.y + 10);
  doc.text("Amount ($)", 350, doc.y + 10);

  doc.text("------------------------------------------------------------", 50);

  // Add transactions to the table
  let yPosition = doc.y + 20;
  data[chatId].transactions.forEach((transaction) => {
    doc.text(transaction.date, 50, yPosition);
    doc.text(transaction.type, 250, yPosition);
    doc.text(transaction.amount.toFixed(2), 350, yPosition);
    yPosition += 20; // Move to next line
  });

  // Total Balance at the end of the table
  doc.text(
    "------------------------------------------------------------",
    50,
    yPosition
  );
  yPosition += 20;
  doc.text(`Total Balance: $${data[chatId].balance.toFixed(2)}`, 50, yPosition);

  // Finalize the PDF document
  doc.end();

  // Wait for the PDF to finish writing to the file
  writeStream.on("finish", () => {
    // Delete the waiting message and send the PDF
    clearInterval(updateProgress); // Stop the progress updates
    ctx.deleteMessage(waitingMessage.message_id);

    // Ensure the file exists before sending
    if (fs.existsSync(filePath)) {
      ctx
        .replyWithDocument({
          source: fs.createReadStream(filePath),
          filename: `mini_statement_${chatId}.pdf`, // Use chatId in the filename
        }) // Set filename to .pdf
        .then(() => {
          // After sending, remove the PDF file to keep the server clean
          fs.unlinkSync(filePath);
        })
        .catch((error) => {
          console.error("Error sending PDF:", error);
          ctx.reply(
            "There was an error while sending your statement. Please try again later."
          );
        });
    } else {
      ctx.reply(
        "The PDF was not generated successfully. Please try again later."
      );
    }
  });
});

const calculateMonthlyInterest = (chatId) => {
  let data = loadData(chatId); // Load all users data
  let monthlyInterest = (data[chatId].balance * 0.07) / 12;
  data[chatId].interestEarned += monthlyInterest;
  data[chatId].balance += monthlyInterest;
  saveData(data); // Save the updated data back to the file
  return monthlyInterest;
};

cron.schedule(
  "0 8 * * *",
  () => {
    let data = loadData(CHAT_ID); // Default to admin chat ID
    bot.telegram.sendMessage(
      CHAT_ID,
      `Good morning! Your balance: $${data[CHAT_ID].balance.toFixed(2)}`
    );
  },
  {
    scheduled: true,
    timezone: "Etc/GMT-3",
  }
);

cron.schedule(
  "0 0 1 * *",
  () => {
    let interest = calculateMonthlyInterest(CHAT_ID); // Default to admin chat ID
    bot.telegram.sendMessage(
      CHAT_ID,
      `Monthly interest added: $${interest.toFixed(
        2
      )}. New balance: $${loadData(CHAT_ID)[CHAT_ID].balance.toFixed(2)}`
    );
  },
  {
    scheduled: true,
    timezone: "Etc/GMT-3",
  }
);

app.listen(3000, () => console.log("Server running on port 3000"));
bot.launch().then(() => console.log("Bot is online!"));
