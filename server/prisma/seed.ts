import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function seedDemoUsers() {
  const demoUsers = [
    {
      name: "Demo Creator",
      email: "creator@brandflight.demo",
      role: "CREATOR" as const,
      password: process.env.DEMO_CREATOR_PASSWORD,
    },
    {
      name: "Demo Manager",
      email: "manager@brandflight.demo",
      role: "MANAGER" as const,
      password: process.env.DEMO_MANAGER_PASSWORD,
    },
    {
      name: "Demo Reviewer",
      email: "reviewer@brandflight.demo",
      role: "REVIEWER" as const,
      password: process.env.DEMO_REVIEWER_PASSWORD,
    },
  ];

  for (const demoUser of demoUsers) {
    if (!demoUser.password || demoUser.password.length < 16) {
      throw new Error(
        `Set a strong ${demoUser.role} demo password in server/.env before seeding.`,
      );
    }

    const passwordHash = await hash(demoUser.password, 12);

    await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {
        name: demoUser.name,
        role: demoUser.role,
      },
      create: {
        name: demoUser.name,
        email: demoUser.email,
        role: demoUser.role,
        passwordHash,
      },
    });
  }

  console.log("Demo creator, manager, and reviewer accounts are ready.");
}

async function main() {
  await seedDemoUsers();
  const brand = await prisma.brandProfile.upsert({
    where: { id: "brandflight-demo" },
    update: {
      name: "PahariKnits",
      description: "Direct-to-consumer Himalayan apparel brand with a product catalogue covering region-specific textiles, materials, dimensions, care guidance, and return terms.",
      brandColors: ["#1D3461", "#152648", "#A86D2B", "#F7F5F1", "#2A7A8A", "#1A2438"],
      accessibilityPairs: [
        { role: "BODY_TEXT", foreground: "#1A2438", background: "#F7F5F1" },
        { role: "HEADING", foreground: "#152648", background: "#F7F5F1" },
        { role: "CTA_TEXT", foreground: "#000000", background: "#A86D2B" },
        { role: "CAPTION", foreground: "#4A5A72", background: "#F7F5F1" },
        { role: "UI_ELEMENT", foreground: "#1D3461", background: "#F7F5F1" },
      ],
    },
    create: {
      id: "brandflight-demo",
      name: "PahariKnits",
      description: "Direct-to-consumer Himalayan apparel brand with a product catalogue covering region-specific textiles, materials, dimensions, care guidance, and return terms.",
      brandColors: ["#1D3461", "#152648", "#A86D2B", "#F7F5F1", "#2A7A8A", "#1A2438"],
      accessibilityPairs: [
        { role: "BODY_TEXT", foreground: "#1A2438", background: "#F7F5F1" },
        { role: "HEADING", foreground: "#152648", background: "#F7F5F1" },
        { role: "CTA_TEXT", foreground: "#000000", background: "#A86D2B" },
        { role: "CAPTION", foreground: "#4A5A72", background: "#F7F5F1" },
        { role: "UI_ELEMENT", foreground: "#1D3461", background: "#F7F5F1" },
      ],
    },
  });

  const rules = [
    {
      ruleCode: "TONE-01",
      category: "TONE" as const,
      title: "Use warm, craft-led product storytelling",
      description: "Write in a warm, respectful, informative voice. Keep product copy specific and grounded in the approved catalogue. Describe regional craft, materials, and techniques only when they are supported for the product being promoted.",
    },
    {
      ruleCode: "TERM-01",
      category: "TERMINOLOGY" as const,
      title: "Avoid unsupported superlatives and guarantees",
      description: "Flag exaggerated superlatives and guarantees such as best, finest, perfect, unmatched, and guaranteed. Factual product labels such as Bestseller are allowed when used as catalogue metadata.",
      pattern: "\\b(best|finest|perfect|guarantee(?:s|d|ing)?|unmatched|number one|no\\.?\\s*1)\\b",
    },
    {
      ruleCode: "CLAIM-01",
      category: "CLAIM" as const,
      title: "Match product claims to the approved catalogue",
      description: "Product names, prices, regional origins, fibre compositions, dimensions, weights, craft techniques, and care instructions must match the approved product facts. Do not transfer a material or technique from one product to another or invent percentages, discounts, performance promises, or delivery terms.",
    },
    {
      ruleCode: "VISUAL-01",
      category: "VISUAL" as const,
      title: "Preserve the PahariKnits visual identity",
      description: "Use the approved navy, cream, logo-copper (#A86D2B), and teal palette. Use black text on logo-copper CTAs; do not use small copper text on cream or white text on copper. Campaign visuals must represent the promoted product accurately and must not imply an unapproved fibre, region, pattern, or craft technique.",
    },
    {
      ruleCode: "ACCESSIBILITY-01",
      category: "ACCESSIBILITY" as const,
      title: "Provide accurate product-image alt text",
      description: "Provide meaningful alt text between 10 and 150 characters. Describe the visible product, pattern, and colour where clear. Do not infer fibre composition, regional origin, artisan identity, or production method from the image alone.",
    },
    {
      ruleCode: "ACCESSIBILITY-02",
      category: "ACCESSIBILITY" as const,
      title: "Maintain readable text contrast in campaign artwork",
      description: "Use the configured role-based WCAG 2.1 contrast pairs. Regular text requires at least 4.5:1 and large text or non-text UI elements require at least 3:1. Avoid placing small copper text over cream backgrounds or text over busy textile details.",
    },
  ];
  for (const rule of rules) {
    await prisma.brandRule.upsert({
      where: {
        brandProfileId_ruleCode: {
          brandProfileId: brand.id,
          ruleCode: rule.ruleCode,
        },
      },
      update: rule,
      create: { ...rule, brandProfileId: brand.id },
    });
  }

  const facts = [
    {
      factCode: "FACT-01",
      claim: "The Kullu Valley Shawl is listed at ₹2,499 and is described as pure Himalayan wool, hand-spun and naturally dyed, with Kullu, Himachal Pradesh as its origin.",
    },
    {
      factCode: "FACT-02",
      claim: "The Kullu Valley Shawl is hand-woven on traditional pit looms and features Kullu buti geometric patterns.",
    },
    {
      factCode: "FACT-03",
      claim: "The Kinnauri Striped Muffler is listed at ₹899 and uses an Angora blend of 70% wool and 30% Angora; its listed origin is Kinnaur, Himachal Pradesh.",
    },
    {
      factCode: "FACT-04",
      claim: "Spiti Hand-Knit Woolen Socks are listed at ₹349 and are made from unbleached Himalayan sheep wool; the listed origin is Spiti Valley, Himachal Pradesh.",
    },
    {
      factCode: "FACT-05",
      claim: "The Chamba Embroidered Stole is listed at ₹1,799 and has a 60% pashmina, 40% silk base with silk embroidery thread; its listed origin is Chamba, Himachal Pradesh.",
    },
    {
      factCode: "FACT-06",
      claim: "The Manali Shepherd's Cap is listed at ₹599 and is made from dense felted wool, hand-blocked and hand-finished; its listed origin is Manali, Himachal Pradesh.",
    },
    {
      factCode: "FACT-07",
      claim: "The Rampur Double-Weave Shawl is listed at ₹3,299 and uses fine merino wool in a double-weave, hand-woven construction; its listed origin is Rampur Bushahr, Himachal Pradesh.",
    },
    {
      factCode: "FACT-08",
      claim: "PahariKnits accepts return requests within 3 days of delivery.",
    },
    {
      factCode: "FACT-09",
      claim: "Returned items must be unused, have their original tags attached, and be in their original packaging.",
    },
  ];
  for (const fact of facts) {
    await prisma.approvedFact.upsert({
      where: {
        brandProfileId_factCode: {
          brandProfileId: brand.id,
          factCode: fact.factCode,
        },
      },
      update: {
        ...fact,
        sourceLabel: "PahariKnits product catalogue and published policies",
      },
      create: {
        ...fact,
        sourceLabel: "PahariKnits product catalogue and published policies",
        brandProfileId: brand.id,
      },
    });
  }

  console.log("PahariKnits demo brand, rules, accessibility standards, and approved facts seeded.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());