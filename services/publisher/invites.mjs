// Supabase sends the invite with the "Invite user" template (supabase/templates/invite.html), only to an
// address with no account yet; someone with an account finds the invite waiting in plan.video.

// Both are whatever their writers typed, and the subject line carries the workspace's.
const oneLine = (value) => (typeof value === "string" ? [...value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim()].slice(0, 80).join("") : "");

export function createInviteMailer({ supabaseUrl, serviceKey, publicUrl, db, fetch: send = fetch }) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  return {
    /** False when the address already has an account, or the email couldn't go. */
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
              invited_by_name: oneLine(name),
              invited_workspace: oneLine(look?.name),
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
