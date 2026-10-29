import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { after, before, describe, it } from "node:test";
import { hash } from "bcryptjs";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  it("API integration suite (set TEST_DATABASE_URL to a separate migrated PostgreSQL database)", { skip: true }, () => {});
} else {
  describe("BrandFlight HTTP API integration", { concurrency: false }, () => {
    const runId = randomUUID().replaceAll("-", "").slice(0, 12);
    const brandId = `brandflight-test-${runId}`;
    const password = "integration-test-password-not-for-production";
    const createdSubmissionIds: string[] = [];
    const demoUserIdsCreatedByTest: string[] = [];
    let app: typeof import("../src/index.js").app;
    let prisma: typeof import("../src/lib/prisma.js").prisma;
    let httpServer: ReturnType<typeof app.listen>;
    let baseUrl = "";
    let creatorToken = "";
    let managerToken = "";
    let reviewerToken = "";
    let creatorId = "";
    let managerId = "";
    let reviewerId = "";

    const userEmails = {
      creator: `creator-${runId}@example.invalid`,
      manager: `manager-${runId}@example.invalid`,
      reviewer: `reviewer-${runId}@example.invalid`,
    };

    type JsonResult = { response: Response; data: any };

    async function requestJson(
      path: string,
      options: RequestInit = {},
      token?: string,
    ): Promise<JsonResult> {
      const headers = new Headers(options.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (options.body !== undefined && !(options.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
      }
      const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
      const data = await response.json().catch(() => null);
      return { response, data };
    }

    async function successfulTextReceipt(content: string): Promise<string> {
      const brand = await prisma.brandProfile.findUniqueOrThrow({
        where: { id: brandId },
        include: {
          rules: { where: { isActive: true } },
          facts: { where: { isActive: true } },
          assets: { where: { assetType: "PRIMARY_LOGO" }, take: 1 },
        },
      });
      const { auditConfigHash, createAuditReceiptId, sha256Text } = await import("../src/lib/audit-receipts.js");
      const receiptId = createAuditReceiptId();
      await prisma.auditReceipt.create({
        data: {
          id: receiptId,
          kind: "TEXT",
          userId: creatorId,
          brandProfileId: brandId,
          inputHash: sha256Text(content),
          configHash: auditConfigHash(brand, "TEXT"),
          result: {
            brand: { id: brand.id, name: brand.name },
            totalFindings: 0,
            findings: [],
            semanticStatus: "completed",
          },
        },
      });
      return receiptId;
    }

    async function createDraft(title: string, content: string, withValidAudit = true) {
      const receiptId = withValidAudit ? await successfulTextReceipt(content) : undefined;
      const { response, data } = await requestJson("/api/submissions", {
        method: "POST",
        body: JSON.stringify({
          title,
          contentText: content,
          brandProfileId: brandId,
          ...(receiptId ? { textAuditReceiptId: receiptId } : {}),
        }),
      }, creatorToken);
      assert.equal(response.status, 201, JSON.stringify(data));
      assert.ok(data.submission?.id);
      createdSubmissionIds.push(data.submission.id);
      return data.submission;
    }

    before(async () => {
      const existingDatabaseUrl = process.env.DATABASE_URL;
      if (existingDatabaseUrl && existingDatabaseUrl === testDatabaseUrl) {
        throw new Error("Refusing to run integration tests: TEST_DATABASE_URL must differ from DATABASE_URL in server/.env.");
      }

      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = testDatabaseUrl;
      process.env.JWT_SECRET = "test-only-jwt-secret-with-at-least-32-characters";
      process.env.DEMO_LOGIN_ENABLED = "true";
      process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
      process.env.CLOUDINARY_API_KEY = "test-key";
      process.env.CLOUDINARY_API_SECRET = "test-secret";
      // Keep tests deterministic and prevent accidental calls to a configured Gemini account.
      delete process.env.GEMINI_API_KEY;

      const { v2: cloudinary } = await import("cloudinary");
      const testUploadStream = (
        _options: unknown,
        callback: (error: Error | null, result?: { secure_url: string; public_id: string }) => void,
      ) => new Writable({
        write(_chunk, _encoding, done) { done(); },
        final(done) {
          callback(null, {
            secure_url: `https://res.cloudinary.com/test-cloud/image/upload/${runId}/campaign.png`,
            public_id: `${runId}/campaign`,
          });
          done();
        },
      });
      (cloudinary.uploader as unknown as { upload_stream: typeof testUploadStream }).upload_stream = testUploadStream;

      ({ app } = await import("../src/index.js"));
      ({ prisma } = await import("../src/lib/prisma.js"));

      const passwordHash = await hash(password, 10);
      const creator = await prisma.user.create({
        data: { name: "Integration Creator", email: userEmails.creator, role: "CREATOR", passwordHash },
      });
      const manager = await prisma.user.create({
        data: { name: "Integration Manager", email: userEmails.manager, role: "MANAGER", passwordHash },
      });
      const reviewer = await prisma.user.create({
        data: { name: "Integration Reviewer", email: userEmails.reviewer, role: "REVIEWER", passwordHash },
      });
      const demoAccounts = [
        { name: "Demo Creator", email: "creator@brandflight.demo", role: "CREATOR" as const },
        { name: "Demo Manager", email: "manager@brandflight.demo", role: "MANAGER" as const },
        { name: "Demo Reviewer", email: "reviewer@brandflight.demo", role: "REVIEWER" as const },
      ];
      for (const demoAccount of demoAccounts) {
        const existingDemoAccount = await prisma.user.findUnique({ where: { email: demoAccount.email } });
        if (!existingDemoAccount) {
          const createdDemoAccount = await prisma.user.create({
            data: { ...demoAccount, passwordHash },
          });
          demoUserIdsCreatedByTest.push(createdDemoAccount.id);
        } else if (existingDemoAccount.role !== demoAccount.role) {
          throw new Error(`Test database has a demo account with the wrong role: ${demoAccount.email}`);
        }
      }
      creatorId = creator.id;
      managerId = manager.id;
      reviewerId = reviewer.id;

      const brand = await prisma.brandProfile.create({
        data: {
          id: brandId,
          name: `Integration Brand ${runId}`,
          description: "Disposable brand profile for automated API integration tests.",
          brandColors: ["#2563EB", "#0F172A", "#FFFFFF"],
          rules: {
            create: [
              {
                ruleCode: "TERM-01",
                category: "TERMINOLOGY",
                title: "Avoid unsupported superlatives",
                description: "Avoid unsupported guarantees and promotional superlatives.",
                pattern: "\\b(revolutionary|guarantee(?:s|d|ing)?|number one)\\b",
              },
              {
                ruleCode: "VISUAL-01",
                category: "VISUAL",
                title: "Follow the brand palette",
                description: "Use approved brand colors.",
              },
              {
                ruleCode: "ACCESSIBILITY-01",
                category: "ACCESSIBILITY",
                title: "Provide alt text",
                description: "Campaign images require meaningful alt text.",
              },
            ],
          },
          facts: {
            create: [
              {
                factCode: "FACT-01",
                claim: "Plans start at ₹499 per month.",
                sourceLabel: "Integration test facts",
              },
            ],
          },
        },
      });

      httpServer = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        httpServer.once("listening", resolve);
        httpServer.once("error", reject);
      });
      const address = httpServer.address();
      assert.ok(address && typeof address !== "string");
      baseUrl = `http://127.0.0.1:${address.port}`;

      const login = async (email: string) => {
        const { response, data } = await requestJson("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        assert.equal(response.status, 200, JSON.stringify(data));
        assert.equal(typeof data.token, "string");
        return data.token as string;
      };
      creatorToken = await login(userEmails.creator);
      managerToken = await login(userEmails.manager);
      reviewerToken = await login(userEmails.reviewer);
    });

    after(async () => {
      if (httpServer) {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
      if (prisma) {
        if (createdSubmissionIds.length) {
          await prisma.submission.deleteMany({ where: { id: { in: createdSubmissionIds } } });
        }
        await prisma.auditReceipt.deleteMany({ where: { brandProfileId: brandId } });
        await prisma.brandProfile.deleteMany({ where: { id: brandId } });
        await prisma.user.deleteMany({ where: { id: { in: [...[creatorId, managerId, reviewerId], ...demoUserIdsCreatedByTest].filter(Boolean) } } });
        await prisma.$disconnect();
      }
    });

    it("keeps one-click demo access explicitly gated and supports all seeded roles", async () => {
      process.env.DEMO_LOGIN_ENABLED = "false";
      const disabled = await requestJson("/api/auth/demo-login", {
        method: "POST",
        body: JSON.stringify({ role: "CREATOR" }),
      });
      assert.equal(disabled.response.status, 403);

      process.env.DEMO_LOGIN_ENABLED = "true";
      for (const role of ["CREATOR", "REVIEWER", "MANAGER"]) {
        const { response, data } = await requestJson("/api/auth/demo-login", {
          method: "POST",
          body: JSON.stringify({ role }),
        });
        assert.equal(response.status, 200, JSON.stringify(data));
        assert.equal(data.user.role, role);
        assert.equal(data.demo, true);
      }
    });

    it("authenticates users and enforces role restrictions", async () => {
      const health = await fetch(`${baseUrl}/api/health`);
      assert.equal(health.status, 200);
      const { response: creatorMe, data: creatorProfile } = await requestJson("/api/auth/me", {}, creatorToken);
      assert.equal(creatorMe.status, 200);
      assert.equal(creatorProfile.user.role, "CREATOR");

      const managerAudit = await requestJson("/api/audit", {
        method: "POST",
        body: JSON.stringify({ brandProfileId: brandId, content: "A simple draft." }),
      }, managerToken);
      assert.equal(managerAudit.response.status, 403);

      const reviewerAudit = await requestJson("/api/audit", {
        method: "POST",
        body: JSON.stringify({ brandProfileId: brandId, content: "A simple draft." }),
      }, reviewerToken);
      assert.equal(reviewerAudit.response.status, 403);
    });

    it("runs a text audit and returns a server-issued receipt", async () => {
      const { response, data } = await requestJson("/api/audit", {
        method: "POST",
        body: JSON.stringify({
          brandProfileId: brandId,
          content: "Our revolutionary service guarantees 100% better results in 2 days.",
        }),
      }, creatorToken);
      assert.equal(response.status, 200, JSON.stringify(data));
      assert.ok(data.auditReceiptId);
      assert.ok(Array.isArray(data.findings));
      assert.ok(data.findings.some((finding: { evidence?: string }) => /revolutionary/i.test(finding.evidence ?? "")));
      assert.ok(data.findings.some((finding: { category?: string }) => finding.category === "CLAIM"));
      // Gemini is intentionally disabled in this suite; this verifies deterministic checks and receipt creation.
      assert.equal(data.semanticStatus, "unavailable");
    });

    it("runs an image audit through a mocked Cloudinary upload", async () => {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SioAAAAASUVORK5CYII=",
        "base64",
      );
      const form = new FormData();
      form.set("brandProfileId", brandId);
      form.set("altText", "Blue campaign banner with a product launch headline");
      form.set("image", new Blob([png], { type: "image/png" }), "campaign.png");

      const response = await fetch(`${baseUrl}/api/audit/image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creatorToken}` },
        body: form,
      });
      const data = await response.json().catch(() => null);
      assert.equal(response.status, 200, JSON.stringify(data));
      assert.ok(data.auditReceiptId);
      assert.equal(data.image.format, "png");
      assert.ok(data.asset.secureUrl.startsWith("https://res.cloudinary.com/test-cloud/"));
    });

    it("persists drafts and rejects submission after the audited copy becomes stale", async () => {
      const originalCopy = "The workspace helps teams coordinate projects.";
      const draft = await createDraft("Stale audit test", originalCopy, true);
      assert.equal(draft.status, "DRAFT");
      assert.equal(draft.revisions.length, 1);

      const changedCopy = "The workspace guarantees 100% better productivity.";
      const { response: patchResponse, data: patchData } = await requestJson(`/api/submissions/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({ contentText: changedCopy }),
      }, creatorToken);
      assert.equal(patchResponse.status, 200, JSON.stringify(patchData));
      assert.equal(patchData.submission.contentText, changedCopy);
      assert.equal(patchData.submission.textAuditReceiptId, null);
      assert.equal(patchData.submission.revisions.length, 2);

      const { response: submitResponse, data: submitData } = await requestJson(`/api/submissions/${draft.id}/submit`, {
        method: "POST",
        body: JSON.stringify({}),
      }, creatorToken);
      assert.equal(submitResponse.status, 409);
      assert.match(submitData.error, /text audit is missing or stale/i);

      const { response: readResponse, data: readData } = await requestJson(`/api/submissions/${draft.id}`, {}, creatorToken);
      assert.equal(readResponse.status, 200);
      assert.equal(readData.submission.contentText, changedCopy);
    });

    it("persists discussion comments and creator override requests", async () => {
      const draft = await createDraft("Discussion test", "This campaign copy is being reviewed.", false);
      const commentBodies = [
        "Please review the source wording before publication.",
        "OVERRIDE REQUEST\nRule(s): TERM-01\nFinding: Contextual terminology\nFlagged evidence: revolutionary\nJustification: This is a direct quotation in an educational campaign and is not a product performance promise.",
      ];
      for (const body of commentBodies) {
        const { response, data } = await requestJson(`/api/submissions/${draft.id}/comments`, {
          method: "POST",
          body: JSON.stringify({ body }),
        }, creatorToken);
        assert.equal(response.status, 201, JSON.stringify(data));
        assert.equal(data.comment.body, body);
      }
      const { response, data } = await requestJson(`/api/submissions/${draft.id}`, {}, creatorToken);
      assert.equal(response.status, 200);
      assert.equal(data.submission.comments.length, 2);
      assert.ok(data.submission.comments.some((comment: { body: string }) => comment.body.startsWith("OVERRIDE REQUEST")));
    });

    it("requires a reason for changes, records review history, supports resubmission, and approves", async () => {
      const copy = "The workspace helps teams coordinate projects.";
      const draft = await createDraft("Review workflow test", copy, true);
      const { response: submitResponse, data: submitData } = await requestJson(`/api/submissions/${draft.id}/submit`, {
        method: "POST",
        body: JSON.stringify({}),
      }, creatorToken);
      assert.equal(submitResponse.status, 200, JSON.stringify(submitData));
      assert.equal(submitData.submission.status, "IN_REVIEW");

      const { response: emptyReasonResponse, data: emptyReasonData } = await requestJson(`/api/submissions/${draft.id}/review`, {
        method: "POST",
        body: JSON.stringify({ status: "CHANGES_REQUESTED", note: "   " }),
      }, reviewerToken);
      assert.equal(emptyReasonResponse.status, 400);
      assert.match(emptyReasonData.error, /reason is required/i);

      const reason = "Please remove the unsupported performance claim and explain the source for the statistic.";
      const { response: changeResponse, data: changeData } = await requestJson(`/api/submissions/${draft.id}/review`, {
        method: "POST",
        body: JSON.stringify({ status: "CHANGES_REQUESTED", note: reason }),
      }, reviewerToken);
      assert.equal(changeResponse.status, 200, JSON.stringify(changeData));
      assert.equal(changeData.submission.status, "CHANGES_REQUESTED");
      assert.ok(changeData.submission.comments.some((comment: { body: string }) => comment.body === reason));

      const changedCopy = "The workspace supports teams as they coordinate projects.";
      const refreshedReceiptId = await successfulTextReceipt(changedCopy);
      const { response: updateResponse, data: updateData } = await requestJson(`/api/submissions/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({ contentText: changedCopy, textAuditReceiptId: refreshedReceiptId }),
      }, creatorToken);
      assert.equal(updateResponse.status, 200, JSON.stringify(updateData));
      assert.equal(updateData.submission.textAuditReceiptId, refreshedReceiptId);

      const { response: resubmitResponse, data: resubmitData } = await requestJson(`/api/submissions/${draft.id}/submit`, {
        method: "POST",
        body: JSON.stringify({}),
      }, creatorToken);
      assert.equal(resubmitResponse.status, 200, JSON.stringify(resubmitData));
      assert.equal(resubmitData.submission.status, "IN_REVIEW");

      const { response: approveResponse, data: approveData } = await requestJson(`/api/submissions/${draft.id}/review`, {
        method: "POST",
        body: JSON.stringify({ status: "APPROVED", note: "Approved after the claim was corrected." }),
      }, reviewerToken);
      assert.equal(approveResponse.status, 200, JSON.stringify(approveData));
      assert.equal(approveData.submission.status, "APPROVED");
      assert.ok(approveData.submission.revisions.length >= 2);

      const { response: historyResponse, data: historyData } = await requestJson("/api/submissions?scope=approved", {}, reviewerToken);
      assert.equal(historyResponse.status, 200, JSON.stringify(historyData));
      assert.ok(historyData.submissions.some((item: { id: string }) => item.id === draft.id));
    });

  });
}
