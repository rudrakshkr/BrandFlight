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
    update: {},
    create: {
      id: "brandflight-demo",
      name: "Northstar Workspace",
      description: "Demo SaaS brand for testing BrandFlight.",
      brandColors: ["#2563EB", "#0F172A", "#FFFFFF"],
    },
  });

  const rules = [
    {
      ruleCode: "TONE-01",
      category: "TONE" as const,
      title: "Clear and confident tone",
      description: "Use clear, professional language. Avoid exaggerated promises.",
    },
    {
      ruleCode: "TERM-01",
      category: "TERMINOLOGY" as const,
      title: "Avoid banned promotional terms",
      description: "Flag unsupported guarantees and superlatives.",
      pattern: "\\b(revolutionary|guarantee(?:s|d|ing)?|number one)\\b",
    },
    {
      ruleCode: "CLAIM-01",
      category: "CLAIM" as const,
      title: "Substantiate promotional claims",
      description: "Numerical performance claims and guarantees must be supported by approved facts.",
    },
    {
      ruleCode: "VISUAL-01",
      category: "VISUAL" as const,
      title: "Use the approved brand palette",
      description: "Campaign image colors should align with the approved brand color palette.",
    },
    {
      ruleCode: "ACCESSIBILITY-01",
      category: "ACCESSIBILITY" as const,
      title: "Provide meaningful image alt text",
      description: "Campaign images require meaningful alternative text of 10 to 150 characters.",
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
      claim: "Standard onboarding takes approximately 10 minutes.",
    },
    {
      factCode: "FACT-02",
      claim: "Plans start at ₹499 per month.",
    },
    {
      factCode: "FACT-03",
      claim: "The free trial lasts 7 days.",
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
      update: fact,
      create: {
        ...fact,
        sourceLabel: "Approved demo product facts",
        brandProfileId: brand.id,
      },
    });
  }

  console.log("BrandFlight demo brand and approved facts seeded.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());