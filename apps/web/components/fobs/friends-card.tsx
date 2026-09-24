// components/fobs/friends-card.tsx
//
// Compact people list for the dashboard rail. The old return-% figure was
// invented — there is no per-person return in the data — so this shows real
// counts (followers, trades) instead.

import Link from "next/link";
import type { Route } from "next";
import type { PersonView } from "@/lib/types";
import { initials } from "@/lib/format";

export function FriendsCard({ people }: { people: PersonView[] }) {
  return (
    <div className="fobs-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Friends</h3>

        <Link href={"/friends" as Route} className="text-xs font-medium text-[#3175c6]">
          View all →
        </Link>
      </div>

      {people.length === 0 ? (
        <p className="text-xs text-[#85867f]">No one to show yet.</p>
      ) : (
        <div className="space-y-4">
          {people.slice(0, 5).map((person) => (
            <Link
              key={person.id}
              href={`/profile/${person.username}` as Route}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e9e5dc] text-[10px] font-semibold">
                  {initials(person.displayName)}
                </div>

                <div>
                  <div className="text-xs font-medium">{person.displayName}</div>
                  <div className="mt-0.5 text-[10px] text-[#898a84]">
                    {person.tradeCount} trade{person.tradeCount === 1 ? "" : "s"}
                  </div>
                </div>
              </div>

              <span className="text-[10px] text-[#777872]">
                {person.followerCount} follower{person.followerCount === 1 ? "" : "s"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
