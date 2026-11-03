CREATE TYPE "OverrideReasonCategory" AS ENUM (
  'RULE_UNCLEAR',
  'CHANNEL_EXCEPTION',
  'FALSE_POSITIVE'
);

ALTER TABLE "Comment"
ADD COLUMN "overrideReasonCategory" "OverrideReasonCategory";
