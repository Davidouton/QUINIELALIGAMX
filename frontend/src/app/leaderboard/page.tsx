import { redirect } from "next/navigation";

export default function LegacyLeaderboardPage() {
  redirect("/dashboard/leaderboard");
}
