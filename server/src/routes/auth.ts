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

authRouter.get("/me", requireAuth, (req, res) => {
  return res.json({ user: req.authUser });
});
