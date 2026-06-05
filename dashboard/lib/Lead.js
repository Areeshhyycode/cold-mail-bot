import mongoose from "mongoose";

// Root project ke Lead schema se match karta hai (same collection)
const leadSchema = new mongoose.Schema(
  {
    businessName: String,
    website: String,
    email: String,
    emailStatus: String,
    ownerName: String,
    niche: String,
    city: String,
    subject: String,
    body: String,
    status: String,
    currentStep: Number,
    lastSentAt: Date,
    sentCount: Number,
    opened: Boolean,
    openCount: Number,
    firstOpenedAt: Date,
    lastOpenedAt: Date,
    campaign: String,
  },
  { timestamps: true }
);

export const Lead = mongoose.models.Lead || mongoose.model("Lead", leadSchema);
