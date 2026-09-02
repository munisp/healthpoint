export function validateOrganizationDetails(orgName: string) {
  const normalized = orgName.trim();
  if (!normalized) return "Organization name is required.";
  if (normalized.length < 2) return "Organization name must contain at least 2 characters.";
  if (normalized.length > 160) return "Organization name must be 160 characters or fewer.";
  return null;
}
