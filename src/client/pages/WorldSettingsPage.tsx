/**
 * World Settings — the panel's first content editor and the A0 DoD surface.
 * Form generated from the SHARED worldSettingsSchema; saving writes a DRAFT
 * (never live), Ctrl+S included; dirty state warns before losing work
 * (ADMIN_DESIGN §1 "never lose work" — full autosave joins the A1 editors).
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { worldSettingsSchema, type WorldSettings } from '@dawned/shared';
import { apiGet, apiPost, apiPut, ApiRequestError } from '../api.js';
import type { AdminUser, WorldSettingsData } from '../../shared-ext/api-types.js';
import { buildFormModel, type FieldEnhancement } from '../schema-form/model.js';
import { SchemaForm } from '../schema-form/SchemaForm.js';

/** Panel-side rendering hints — validation stays in the shared schema. */
const ENHANCEMENTS: Record<keyof WorldSettings, FieldEnhancement> = {
  xpRate: {
    label: 'XP rate',
    help: 'Multiplies every XP gain. 1 = designed pace; weekend events raise it.',
    unit: '×',
    step: 0.25,
  },
  dayNightEnabled: {
    label: 'Day/night cycle',
    help: 'Visual cycle master switch — the feature itself ships with P14.',
  },
  motd: {
    label: 'Message of the day',
    help: 'Whispered to every player on join. Leave empty for none.',
    control: 'textarea',
  },
};

const MODEL = buildFormModel(worldSettingsSchema);

export const WorldSettingsPage = ({ user }: { user: AdminUser }) => {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['world-settings'],
    queryFn: () => apiGet<WorldSettingsData>('/world-settings'),
  });

  const [edited, setEdited] = useState<Record<string, unknown> | null>(null);
  const serverDraft = settings.data?.draft;
  const form: Record<string, unknown> = edited ?? serverDraft ?? {};

  const dirty = useMemo(
    () => edited !== null && JSON.stringify(edited) !== JSON.stringify(serverDraft),
    [edited, serverDraft],
  );
  const parsed = worldSettingsSchema.safeParse(form);
  const canWrite = user.role === 'admin';

  /**
   * The rail A0 documented and A1 never built: without it the game — which reads
   * `content_world_settings` WHERE status = 'published' — never saw a single one
   * of these edits, so every lever on this page sat at its compiled-in default.
   */
  const publish = useMutation({
    mutationFn: async () =>
      apiPost<{ published: number; reload: { ok: boolean; note: string } }>(
        '/publish/world-settings',
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['world-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const save = useMutation({
    mutationFn: async (next: WorldSettings) => apiPut<WorldSettingsData>('/world-settings', next),
    onSuccess: (data) => {
      queryClient.setQueryData(['world-settings'], data);
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setEdited(null);
    },
  });

  // Ctrl+S saves the draft; the browser's save dialog never helps here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty && parsed.success && canWrite && !save.isPending) save.mutate(parsed.data);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [dirty, parsed, canWrite, save]);

  // Leaving with unsaved edits warns (dirty markers per ADMIN_DESIGN §1).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  if (settings.isLoading) return <div className="loading">Loading world settings…</div>;
  if (settings.isError || !settings.data) {
    return <div className="error-banner">World settings failed to load — retry via reload.</div>;
  }

  const draftKeys = settings.data.draftKeys;
  const saveError =
    save.error instanceof ApiRequestError ? save.error.message : save.error ? 'Save failed.' : null;

  return (
    <>
      <h1 className="page-title">World Settings</h1>
      <p className="page-sub">
        Live feature flags and global tuning. Edits save as a <b>draft</b>; <b>Publish</b> copies
        them onto the live rows and hot-reloads the running game — no restart, no deploy.
      </p>
      {saveError && <div className="error-banner">{saveError}</div>}
      {publish.isError && (
        <div className="error-banner">
          {publish.error instanceof ApiRequestError ? publish.error.message : 'Publish failed.'}
        </div>
      )}
      {publish.isSuccess && (
        <div className="ws-help" style={{ marginBottom: 12 }}>
          Published {publish.data.published} setting(s) —{' '}
          {publish.data.reload.ok
            ? 'the running game picked them up.'
            : `the game did not reload (${publish.data.reload.note}).`}
        </div>
      )}
      {!canWrite && (
        <div className="ws-help" style={{ marginBottom: 12 }}>
          Signed in as <b>gm</b> — world settings are read-only; drafts need an admin.
        </div>
      )}
      <SchemaForm
        schema={worldSettingsSchema}
        model={MODEL}
        enhancements={ENHANCEMENTS}
        value={form}
        draftKeys={draftKeys}
        disabled={!canWrite || save.isPending}
        onChange={(key, value) => {
          setEdited({ ...form, [key]: value });
        }}
      />
      <div className="form-toolbar">
        <button
          className="ws-btn ws-btn--primary"
          disabled={!dirty || !parsed.success || !canWrite || save.isPending}
          onClick={() => {
            if (parsed.success) save.mutate(parsed.data);
          }}
        >
          {save.isPending ? 'Saving…' : 'Save draft'} <span className="ws-kbd">Ctrl S</span>
        </button>
        {dirty && <span className="dirty-note">Unsaved changes</span>}
        <button
          className="ws-btn ws-btn--primary"
          disabled={draftKeys.length === 0 || dirty || !canWrite || publish.isPending}
          title={
            dirty
              ? 'Save the draft first.'
              : draftKeys.length === 0
                ? 'No draft changes to publish.'
                : `Publish ${draftKeys.length} changed setting(s) to the live game.`
          }
          onClick={() => {
            publish.mutate();
          }}
        >
          {publish.isPending ? 'Publishing…' : `Publish ${draftKeys.length || ''}`.trim()}
        </button>
        <div className="spacer" />
        {draftKeys.length > 0 && (
          <button
            className="ws-btn"
            disabled={!canWrite || save.isPending}
            title="Set every field back to the published values (saves the pruned draft)."
            onClick={() => {
              save.mutate(settings.data.published);
            }}
          >
            Discard draft → published values
          </button>
        )}
      </div>
    </>
  );
};
