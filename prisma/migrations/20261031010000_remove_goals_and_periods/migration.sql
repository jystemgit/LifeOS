BEGIN;

DROP TABLE "PlanningPeriodGoal", "GoalRelationship", "Milestone", "PlanningPeriod", "Goal";
DROP TYPE "GoalType", "GoalStatus", "GoalPriority", "GoalRelationshipType", "PlanningPeriodType";

COMMIT;
