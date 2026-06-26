export function getImageDateLabel(capturedAt: string | null): string {
  if (!capturedAt) {
    return "Undated";
  }

  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) {
    return "Undated";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(date);
}
