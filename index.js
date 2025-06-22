import express from "express";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import pkg from "pg";
import { ClerkExpressRequireAuth, clerkClient } from "@clerk/clerk-sdk-node";

dotenv.config();

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 4000;

// Allowed origins for CORS
const allowedOrigins = [
  "http://localhost:5173",
  "https://greeenshop.vercel.app",
  "https://amazon-backend-q7s7.onrender.com"
];

// Configure CORS with dynamic origin check
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc)
    if (!origin) return callback(null, true);
   
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
   
    // Check if origin is a subdomain of allowed domains
    const originHost = new URL(origin).hostname;
    const isAllowed = allowedOrigins.some(allowed => {
      const allowedHost = new URL(allowed).hostname;
      return originHost === allowedHost ||
             originHost.endsWith(`.${allowedHost}`);
    });
   
    callback(isAllowed ? null : new Error("Not allowed by CORS"), isAllowed);
  },
  credentials: true,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Handle preflight requests
app.options("*", cors());

// Set credentials header
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

const requireAuth = ClerkExpressRequireAuth();

console.log("✅ Clerk initialized successfully");
console.log("✅ Clerk Secret Key:", process.env.CLERK_SECRET_KEY?.slice(0, 8) + "...");
console.log("✅ Database URL:", process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || "Connected");

// GET products — public route
app.get("/api/products", async (req, res) => {
  try {
    console.log("📦 Fetching products...");
    const raw = fs.readFileSync("products.json");
    const data = JSON.parse(raw);
    const products = data.products;

    const filtered = products.filter(
      (p) =>
        p.code &&
        p.product_name &&
        (p.image_url || p.image_front_url) &&
        p.nutriscore_grade &&
        p.environmental_score_data?.grade !== "unknown"
    );

    console.log(`✅ Found ${filtered.length} products, returning top 50`);
    res.json(filtered.slice(0, 50));
  } catch (error) {
    console.error("❌ Error reading products.json:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /purchase — requires authentication
app.post("/api/purchase", requireAuth, async (req, res) => {
  const { userId } = req.auth;
  console.log(`🛒 Purchase request from user: ${userId}`);

  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.emailAddresses[0]?.emailAddress;

    if (!email) {
      console.error("❌ User email not found");
      throw new Error("User email not found");
    }

    const { product_code, product_name, price, image_url } = req.body;
    console.log(`💳 Processing purchase for product: ${product_name}`);

    await pool.query(
      `INSERT INTO users (id, email)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [userId, email]
    );

    await pool.query(
      `INSERT INTO purchases (user_id, product_code, product_name, price, image_url)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, product_code, product_name, price, image_url]
    );

    console.log("✅ Purchase recorded successfully");
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error inserting purchase:", error);
    res.status(500).json({
      error: error.message,
      details:
        "Ensure your users table has an 'email' column that allows nulls or has a default.",
    });
  }
});

// GET /purchases — requires authentication
app.get("/api/purchases", requireAuth, async (req, res) => {
  const { userId } = req.auth;
  console.log(`📋 Fetching purchases for user: ${userId}`);

  try {
    const result = await pool.query(
      `SELECT product_code, product_name, price, image_url
       FROM purchases
       WHERE user_id = $1
       ORDER BY purchased_at DESC`,
      [userId]
    );

    console.log(`✅ Found ${result.rowCount} purchases for user`);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching purchases:", error);
    res.status(500).json({ error: "Failed to fetch purchases" });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development"
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
  console.log(`🌐 Allowed origins: ${allowedOrigins.join(", ")}`);
});
