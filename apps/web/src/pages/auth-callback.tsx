/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { DASHBOARD_PATH } from '@/hooks/use-project-route';
import { t } from '@/lib/i18n';
import { takeReturn } from '@/lib/return-after-sign-in';
import { supabase } from '@/lib/supabase';

export function AuthCallbackPage() {
  const navigate = useNavigate();

  onMount(async () => {
    if (supabase) {
      await supabase.auth.getSession();
    }

    navigate(takeReturn() ?? DASHBOARD_PATH, { replace: true });
  });

  return (
    <div class="grid h-screen place-items-center bg-background">
      <p class="text-sm text-muted-foreground">{t('Signing you in...')}</p>
    </div>
  );
}
