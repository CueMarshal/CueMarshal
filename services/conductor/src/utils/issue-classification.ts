export interface IssueClassificationInput {
  labels?: string[];
  body?: string | null;
}

const SONAR_LABELS = new Set(["source:sonar", "sonar"]);
const SONAR_TEMPLATE_MARKERS = [
  "Sonar Key:",
  "Sonar Rule:",
  "From SonarQube",
  "source:sonar",
];

export function isSonarFinding(input: IssueClassificationInput): boolean {
  const labels = (input.labels ?? []).map((label) => label.toLowerCase());
  if (labels.some((label) => SONAR_LABELS.has(label))) {
    return true;
  }

  const body = input.body ?? "";
  return SONAR_TEMPLATE_MARKERS.some((marker) => body.includes(marker));
}
