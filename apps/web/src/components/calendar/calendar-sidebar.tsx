/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CalendarAccounts } from "./accounts-list";

/**
 * The calendar's accounts, under the dashboard's own links while the calendar
 * is open. Its small month lives in the page header, under the month's name.
 */
export function CalendarSidebar() {
  return <CalendarAccounts />;
}
