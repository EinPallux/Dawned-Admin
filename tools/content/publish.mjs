/**
 * Publish a content rail, treating "nothing to publish" as success.
 *
 * A draft identical to what is already live prunes itself on save, so a
 * re-run of a content script leaves an EMPTY diff — and the publish endpoint
 * refuses an empty publish. That refusal is correct for a human pressing the
 * button (it means "you have no changes") and wrong for a script, whose whole
 * contract is that running it twice is safe: fixing one placement must not mean
 * re-authoring a catalogue.
 *
 * `deploy/WORLD.sh` (game repo) is what made this urgent. It runs the whole
 * chain on the live box and resumes with `--from N`, so the SECOND pass over an
 * already-published step is the normal case, not an edge one — and
 * `author-items.mjs` failed the deploy at step 4 with
 *
 *     ❌ publish refused: [ "nothing to publish" ]
 *
 * on a world where everything it wanted was already exactly right.
 *
 * `author-nodes.mjs` and `author-quests.mjs` grew their own copies of this rule
 * (they were written after that lesson); they should adopt this module the next
 * time they are touched, so the rule lives in one place rather than three.
 */

/** @typedef {{ published?: number, warnings?: string[], reload?: { ok?: boolean, note?: string } }} PublishResult */

/**
 * @param {string} baseUrl
 * @param {Record<string, string>} headers  must carry the session cookie + content-type
 * @param {string} rail   the publish rail: 'items' | 'enemies' | 'quests' | …
 * @param {string} label  what to call the rows in the log
 * @returns {Promise<PublishResult | null>} null when there was nothing to publish
 */
export const publishRail = async (baseUrl, headers, rail, label = rail) => {
  const response = await fetch(`${baseUrl}/api/publish/${rail}`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const payload = await response.json().catch(() => null);
  const problems = payload?.problems ?? [];

  // Every problem being "nothing to publish" means the live rows already match.
  // Requiring EVERY problem to be that (rather than just one) keeps a real
  // refusal from being swallowed because it happened to arrive alongside it.
  const nothingPending =
    problems.length > 0 && problems.every((problem) => /nothing to publish/i.test(String(problem)));
  if (nothingPending) {
    console.log(`✅ ${label}: already live, nothing to publish`);
    return null;
  }

  if (!response.ok || !payload?.ok) {
    const detail = problems.length ? problems.join('\n   • ') : JSON.stringify(payload);
    throw new Error(`${label} publish refused:\n   • ${detail}`);
  }

  console.log(`✅ published ${payload.published} ${label}`);
  for (const warning of payload.warnings ?? []) console.log(`   ⚠️  ${warning}`);
  if (payload.reload) {
    console.log(
      payload.reload.ok
        ? `✅ game hot-reloaded: ${payload.reload.note ?? ''}`
        : `⚠️  game not reloaded (${payload.reload.note ?? 'no response'})`,
    );
  }
  return payload;
};
