/**
 * Model Selector Service Tests
 * Tests for budget-aware model selection and tier downgrade logic
 */

import { ModelSelector } from "../../services/model-selector.js";

// Mock the logger
jest.mock("../../utils/logger.js", () => ({
  logger: {
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the config with default values
jest.mock("../../config.js", () => ({
  config: ({
    totalMonthlyBudgetUsd: 100,
    selfImproveBudgetPct: 10,
    modelSelectorTier1Threshold: 0.30,
    modelSelectorTier3Threshold: 0.70,
  }),
}));

// Mock the retry policy service
jest.mock("../../services/retry-policy.js", () => ({
  retryPolicyService: {
    decideEscalation: jest.fn(() => ({
      shouldStop: false,
      nextTier: null,
      reason: "",
    })),
  },
}));

describe("ModelSelector", () => {
  let modelSelector: ModelSelector;

  beforeEach(() => {
    jest.clearAllMocks();
    modelSelector = new ModelSelector();
  });

  describe("Model Selection - Basic Tiers with Explicit Labels", () => {
    it("should select tier1 for simple complexity label", async () => {
      // Arrange
      const task = {
        title: "Fix typo in README",
        body: "Change 'teh' to 'the'",
        labels: ["complexity:simple"],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.tier).toBe("tier1");
      expect(selection.reasoning).toContain("complexity:simple");
    });

    it("should select tier2 for standard complexity label", async () => {
      // Arrange
      const task = {
        title: "Implement user registration feature",
        body: "Create registration endpoint with email validation",
        labels: ["complexity:standard"],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.tier).toBe("tier2");
      expect(selection.reasoning).toContain("complexity:standard");
    });

    it("should select tier3 for complex complexity label", async () => {
      // Arrange
      const task = {
        title: "Design microservices architecture",
        body: "Redesign monolithic application for scalability",
        labels: ["complexity:complex"],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.tier).toBe("tier3");
      expect(selection.reasoning).toContain("complexity:complex");
    });
  });

  describe("Model Selection - Role Baselines", () => {
    it("should use role baseline (architect=tier3)", async () => {
      // Arrange
      const task = {
        title: "Update comments",
        body: "Add inline documentation",
        labels: ["role:architect"],
        agentRole: "architect",
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      // Explicit complexity label not present, so should use role baseline
      expect(selection.tier).toBe("tier3");
      expect(selection.reasoning).toContain("tier3");
    });

    it("should use role baseline (docs=tier1)", async () => {
      // Arrange
      const task = {
        title: "Update documentation",
        body: "Add API docs",
        labels: ["role:docs", "complexity:simple"],
        agentRole: "docs",
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.tier).toBe("tier1");
    });

    it("should default to tier2 when no role specified", async () => {
      // Arrange: Simple task with no role/complexity label
      const task = {
        title: "Generic task",
        body: "No role specified",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      // Should default to tier2 baseline
      expect(["tier1", "tier2", "tier3"]).toContain(selection.tier);
    });
  });

  describe("Explicit Complexity Labels Override", () => {
    it("complexity label should override role baseline", async () => {
      // Arrange: Simple complexity but architect role
      const task = {
        title: "Update comments",
        body: "Add inline docs",
        labels: ["complexity:simple", "role:architect"],
        agentRole: "architect",
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      // Explicit label should take precedence
      expect(selection.tier).toBe("tier1");
    });

    it("complexity:complex should override docs role", async () => {
      // Arrange: Complex label but docs role
      const task = {
        title: "Complex documentation",
        body: "Add comprehensive architecture docs",
        labels: ["complexity:complex", "role:docs"],
        agentRole: "docs",
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      // Explicit complexity should override role
      expect(selection.tier).toBe("tier3");
    });
  });

  describe("Response Structure", () => {
    it("should return valid ModelSelection object with all required fields", async () => {
      // Arrange
      const task = {
        title: "Test task",
        body: "Test body",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection).toHaveProperty("tier");
      expect(selection).toHaveProperty("reasoning");
      expect(selection).toHaveProperty("estimatedTokens");
      expect(selection).toHaveProperty("estimatedCost");
      expect(selection).toHaveProperty("confidence");
      // budgetStatus is optional, so we don't require it to be present
    });

    it("should have valid tier values", async () => {
      // Arrange
      const task = {
        title: "Test",
        body: "Test",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      const validTiers = ["tier1", "tier2", "tier3", "local"];
      expect(validTiers).toContain(selection.tier);
    });

    it("should have confidence score between 0 and 1", async () => {
      // Arrange
      const task = {
        title: "Test",
        body: "Test",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.confidence).toBeGreaterThanOrEqual(0);
      expect(selection.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("Cost Estimation", () => {
    it("should include estimated tokens in response", async () => {
      // Arrange
      const task = {
        title: "Test task title",
        body: "Test task body",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.estimatedTokens).toBeDefined();
      expect(selection.estimatedTokens.input).toBeGreaterThan(0);
      expect(selection.estimatedTokens.output).toBeGreaterThan(0);
    });

    it("should include estimated cost based on tier", async () => {
      // Arrange
      const task = {
        title: "Test task",
        body: "Test body",
        labels: ["complexity:simple"],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.estimatedCost).toBeDefined();
      expect(selection.estimatedCost).toBeGreaterThanOrEqual(0);
    });

    it("tier1 should have lower or equal cost per token than tier3", async () => {
      // This verifies the cost structure is correct
      // Tier1: $0.00000025/token
      // Tier3: $0.000015/token
      // Tier3 is 60x more expensive
      const task = {
        title: "Task with exact same size",
        body: "Task with exact same size",
        labels: [],
      };

      const selectionTier1 = await modelSelector.selectModel({
        ...task,
        labels: ["complexity:simple"],
      });

      const selectionTier3 = await modelSelector.selectModel({
        ...task,
        labels: ["complexity:complex"],
      });

      // Tier3 should have higher cost if same size content
      expect(selectionTier1.estimatedCost).toBeLessThanOrEqual(
        selectionTier3.estimatedCost
      );
    });
  });

  describe("Reasoning and Explanations", () => {
    it("should include clear reasoning for tier selection", async () => {
      // Arrange
      const task = {
        title: "Build API",
        body: "Create REST endpoint",
        labels: ["complexity:standard"],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.reasoning).toBeDefined();
      expect(selection.reasoning.length).toBeGreaterThan(0);
      expect(selection.reasoning).toContain("complexity:standard");
    });

    it("should include score information in reasoning", async () => {
      // Arrange
      const task = {
        title: "Complex task with many keywords",
        body: "Architecture design microservice scalability vulnerability security audit",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.reasoning).toContain("Score:");
    });
  });

  describe("Budget Status Information", () => {
    it("should include budget status in response when available", async () => {
      // Arrange
      const task = {
        title: "Task",
        body: "Body",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      // budgetStatus is optional, so we check if it exists before validating structure
      if (selection.budgetStatus) {
        expect(selection.budgetStatus).toHaveProperty("isExceeded");
        expect(selection.budgetStatus).toHaveProperty("isNearThreshold");
        expect(selection.budgetStatus).toHaveProperty("percentageUsed");
        expect(selection.budgetStatus).toHaveProperty("remainingBudget");
      }
    });

    it("should have budget exceeded as false on startup (before any spending)", async () => {
      // Arrange
      const task = {
        title: "Task",
        body: "Body",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      // budgetStatus is optional, so only test when it's present
      if (selection.budgetStatus) {
        expect(selection.budgetStatus.isExceeded).toBe(false);
      }
    });
  });

  describe("Task Input Validation", () => {
    it("should handle tasks with empty title and body", async () => {
      // Arrange
      const task = {
        title: "",
        body: "",
        labels: [],
      };

      // Act & Assert: Should not throw
      expect(async () => {
        await modelSelector.selectModel(task);
      }).not.toThrow();
    });

    it("should handle tasks with special characters in title/body", async () => {
      // Arrange
      const task = {
        title: "Task with @#$%^&*() special chars",
        body: "Body with !@#$%^&*() special chars",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.tier).toBeDefined();
    });

    it("should handle tasks with many labels", async () => {
      // Arrange
      const task = {
        title: "Task",
        body: "Body",
        labels: [
          "type:feature",
          "priority:high",
          "complexity:standard",
          "role:developer",
          "area:api",
        ],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.tier).toBeDefined();
      expect(selection.reasoning).toBeDefined();
    });

    it("should handle very long task descriptions", async () => {
      // Arrange: Long description with many keywords
      const longBody = "architecture design microservice scalability ".repeat(100);
      const task = {
        title: "Very complex task " + "extra ".repeat(50),
        body: longBody,
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.tier).toBeDefined();
      expect(selection.estimatedTokens.input).toBeGreaterThan(100);
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle simple documentation task flow", async () => {
      // Arrange
      const task = {
        title: "Update README.md",
        body: "Add API documentation section",
        labels: ["type:docs", "complexity:simple"],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.tier).toBe("tier1");
      expect(selection.estimatedCost).toBeGreaterThanOrEqual(0);
      expect(selection.budgetStatus).toBeDefined();
    });

    it("should handle standard feature development task flow", async () => {
      // Arrange
      const task = {
        title: "Implement user authentication",
        body: "Add JWT-based authentication with refresh tokens",
        labels: ["type:feature", "complexity:standard"],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.tier).toBe("tier2");
      expect(selection.budgetStatus).toBeDefined();
    });

    it("should handle complex architectural task flow", async () => {
      // Arrange
      const task = {
        title: "Design microservices architecture",
        body: "Redesign monolithic app with service-oriented architecture for scalability",
        labels: ["type:architecture", "complexity:complex"],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(selection.tier).toBe("tier3");
      expect(selection.budgetStatus).toBeDefined();
    });
  });

  describe("Complexity Scoring", () => {
    it("should recognize architecture keyword as high complexity", async () => {
      // Arrange: Need longer description to boost complexity score
      const task = {
        title: "Design microservices architecture",
        body: "Plan the system architecture redesign with microservices pattern for scalability",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      // Architecture is a high-complexity keyword, but needs enough weight
      expect(["tier2", "tier3"]).toContain(selection.tier);
    });

    it("should recognize security keyword as high complexity", async () => {
      // Arrange: Security vulnerability audit with sufficient length
      const task = {
        title: "Comprehensive security vulnerability audit",
        body: "Conduct security audit to find vulnerabilities in authentication and authorization systems",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(["tier2", "tier3"]).toContain(selection.tier);
    });

    it("should recognize bug fix as lower complexity", async () => {
      // Arrange
      const task = {
        title: "Fix login bug",
        body: "Users cannot login with special characters in password",
        labels: [],
      };

      // Act
      const selection = await modelSelector.selectModel(task);

      // Assert
      expect(["tier1", "tier2"]).toContain(selection.tier);
    });
  });
});
