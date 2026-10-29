import { Router } from "express";
import { compare } from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(500).json({ error: "Authentication is not configured." });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = jwt.sign(
      {},
      secret,
      { subject: user.id, expiresIn: "8h" },
    );

    return res.json({
      token,
      expiresIn: 28800,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ error: "Unable to complete login." });
  }
});

const DEMO_ACCOUNT_EMAILS: Record<"CREATOR" | "REVIEWER" | "MANAGER", string> = {
  CREATOR: "creator@brandflight.demo",
  REVIEWER: "reviewer@brandflight.demo",
  MANAGER: "manager@brandflight.demo",
};

// This endpoint is deliberately opt-in. It authenticates as one of the seeded,
// least-privilege demo accounts; it never trusts a role supplied as a JWT claim.
authRouter.post("/demo-login", async (req, res) => {
  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    return res.status(403).json({
      error: "Demo sign-in is disabled. Enable DEMO_LOGIN_ENABLED for judge access.",
    });
  }

  const requestedRole: unknown = req.body?.role;
  if (
    typeof requestedRole !== "string" ||
    !Object.prototype.hasOwnProperty.call(DEMO_ACCOUNT_EMAILS, requestedRole)
  ) {
    return res.status(400).json({ error: "Choose Creator, Reviewer, or Manager." });
  }

  const role = requestedRole as keyof typeof DEMO_ACCOUNT_EMAILS;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    return res.status(500).json({ error: "Authentication is not configured." });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: DEMO_ACCOUNT_EMAILS[role] },
    });

    if (!user || user.role !== role) {
      return res.status(503).json({
        error: "The requested demo account is not available. Seed the three BrandFlight demo accounts first.",
      });
    }

    const token = jwt.sign({}, secret, { subject: user.id, expiresIn: "8h" });
    return res.json({
      token,
      expiresIn: 28800,
      demo: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Demo login failed:", error);
    return res.status(500).json({ error: "Unable to open the requested demo role." });
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  return res.json({ user: req.authUser });
});
