export type ReviewDecisionStatus = "APPROVED" | "CHANGES_REQUESTED";

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

  if (note !== undefined && (typeof note !== "string" || note.length > 2000)) {
    return { valid: false, error: "Review note must be 2,000 characters or fewer." };
  }

  if (status === "CHANGES_REQUESTED" && (typeof note !== "string" || !note.trim())) {
    return {
      valid: false,
      error: "A non-empty reason is required when requesting changes.",
    };
  }

  const normalizedNote = typeof note === "string" ? note.trim() : undefined;
  return {
    valid: true,
    status,
    ...(normalizedNote ? { note: normalizedNote } : {}),
  };
}
