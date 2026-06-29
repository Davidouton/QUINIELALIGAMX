const VIP_SUMMARY_PARAMS = new URLSearchParams({
  include_leaderboard: "false",
  include_member_dashboard: "false",
  include_approved_members: "false",
  include_team_winner_details: "false",
});

export const VIP_SUMMARY_PATH = `/vip?${VIP_SUMMARY_PARAMS.toString()}`;

export function buildVipDetailPath(vipId: string) {
  const params = new URLSearchParams({ vip_id: vipId });
  return `/vip?${params.toString()}`;
}
