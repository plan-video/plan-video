// The email that tells someone they were asked into a workspace. Supabase
// sends it, with the "Invite user" template (supabase/templates/invite.html),
// to an address that has no account yet: its link makes the account and opens
// the invite. Someone who already has an account finds the invite waiting the
// next time they open plan.video, so nothing is sent to them.

export function createInviteMailer({ supabaseUrl, serviceKey, publicUrl, db, fetch: send = fetch }) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  return {
    /** True when Supabase sent it; false when the address already has an account, or the email couldn't go. */
    async invite({ id, owner_id: owner, workspace_id: workspace, email, invited_by: invitedBy }) {
      const [name, look] = await Promise.all([
        invitedBy ? db.rpc("person_name", { person: invitedBy }).catch(() => null) : null,
        db.rpc("workspace_look", { owner, workspace }).catch(() => null),
      ]);
      const redirect = `${publicUrl}/dashboard?invite=${encodeURIComponent(id)}`;
      let response;
      try {
        response = await send(`${supabaseUrl}/auth/v1/invite?redirect_to=${encodeURIComponent(redirect)}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            email,
            // What the template says (supabase/templates/invite.html), and the invite its link opens.
            data: {
              invited_by_name: typeof name === "string" ? name.slice(0, 80) : "",
              invited_workspace: typeof look?.name === "string" ? look.name.slice(0, 80) : "",
              invite_id: id,
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        console.error("[publisher] invite email failed", error instanceof Error ? error.message : error);
        return false;
      }
      if (response.ok) return true;
      // 422: the address already has an account. They'll see the invite in plan.video.
      if (response.status !== 422) console.error("[publisher] invite email refused", response.status, (await response.text().catch(() => "")).slice(0, 300));
      return false;
    },
  };
}
