/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { A } from '@solidjs/router';
import { onCleanup, onMount } from 'solid-js';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

export function NotFoundPage() {
  // Its own title, and kept out of search wherever the app draws it (an
  // unknown slug under a real page's address too, which the server can't tell).
  onMount(() => {
    const previous = document.title;
    document.title = t('{title} | plan.video', { title: t('Page not found') });
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.append(robots);
    onCleanup(() => {
      document.title = previous;
      robots.remove();
    });
  });

  return (
    <div class="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <div class="relative z-10 text-center px-6">
        <h1 class="mb-8">
          <span
            class="bg-gradient-to-b from-foreground to-muted-foreground text-[12rem] font-extralight tracking-tighter leading-none text-transparent bg-clip-text select-none font-mono"
          >
            404
          </span>
          <span class="sr-only">{t('Page not found')}</span>
        </h1>

        <p class="text-muted-foreground text-lg font-light  mb-4">
          {t('Nothing here.')}
        </p>

        <Button as={A} href="/" variant="ghost">
          {t('Back home')}
        </Button>
      </div>
    </div>
  );
}
