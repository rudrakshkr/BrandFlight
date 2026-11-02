export type ReviewDecisionStatus = "APPROVED" | "CHANGES_REQUESTED";

export const MIN_REVIEW_NOTE_LENGTH = 10;
export const MAX_REVIEW_NOTE_LENGTH = 2000;
export const MIN_CREATOR_UPDATE_LENGTH = 10;
export const MAX_CREATOR_UPDATE_LENGTH = 1000;

export type CreatorUpdateValidation =
  | { valid: true; summary: string }
  | { valid: false; error: string };

export function validateCreatorUpdateSummary(value: unknown): CreatorUpdateValidation {
  if (typeof value !== "string") {
    return { valid: false, error: "Describe the changes made before submitting this campaign." };
  }

  const summary = value.trim();
  if (summary.length < MIN_CREATOR_UPDATE_LENGTH) {
    return {
      valid: false,
      error: `The change summary must contain at least ${MIN_CREATOR_UPDATE_LENGTH} characters.`,
    };
  }
  if (summary.length > MAX_CREATOR_UPDATE_LENGTH) {
    return {
      valid: false,
      error: `The change summary must be ${MAX_CREATOR_UPDATE_LENGTH} characters or fewer.`,
    };
  }
  return { valid: true, summary };
}

export type ReviewDecisionValidation =
  | { valid: true; status: ReviewDecisionStatus; note?: string }
  | { valid: false; error: string };

/** Validate review decision payloads at the API boundary, not only in the UI. */
export function validateReviewDecision(
  status: unknown,
  note: unknown,
): ReviewDecisionValidation {
  if (status !== "APPROVED" && status !== "CHANGES_REQUESTED") {
    return { valid: false, error: "Status must be APPROVED or CHANGES_REQUESTED." };
  }

  if (note !== undefined && (typeof note !== "string" || note.length > MAX_REVIEW_NOTE_LENGTH)) {
    return { valid: false, error: "Review note must be 2,000 characters or fewer." };
  }

  if (
    status === "CHANGES_REQUESTED" &&
    (typeof note !== "string" || note.trim().length < MIN_REVIEW_NOTE_LENGTH)
  ) {
    return {
      valid: false,
      error: `A reason of at least ${MIN_REVIEW_NOTE_LENGTH} characters is required when requesting changes.`,
    };
  }

  const normalizedNote = typeof note === "string" ? note.trim() : undefined;
  return {
    valid: true,
    status,
    ...(normalizedNote ? { note: normalizedNote } : {}),
  };
}
