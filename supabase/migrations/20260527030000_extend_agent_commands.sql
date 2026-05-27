-- ─────────────────────────────────────────────────────────────
-- agent_commands.type の CHECK 制約を Phase F (Claude Code 級の自由実行) 用に拡張
--
-- 旧: open_url / open_google_auth / open_gws_auth / open_browser_auth / run_shell /
--     restart_agent / pause_agent / resume_agent / upload_logs / scan_capabilities
--
-- 新: 上記 + file_read / file_write / file_list / file_delete /
--     browser_navigate / browser_click / browser_fill / browser_screenshot /
--     browser_text / browser_close_session / cancel_command
-- ─────────────────────────────────────────────────────────────

ALTER TABLE agent_commands DROP CONSTRAINT IF EXISTS agent_commands_type_check;

ALTER TABLE agent_commands
  ADD CONSTRAINT agent_commands_type_check
  CHECK (
    type IN (
      -- Phase A-E (既存)
      'open_url',
      'open_google_auth',
      'open_gws_auth',
      'open_browser_auth',
      'run_shell',
      'restart_agent',
      'pause_agent',
      'resume_agent',
      'upload_logs',
      'scan_capabilities',
      -- Phase F: ファイルI/O
      'file_read',
      'file_write',
      'file_list',
      'file_delete',
      -- Phase F: ブラウザ インタラクション
      'browser_navigate',
      'browser_click',
      'browser_fill',
      'browser_screenshot',
      'browser_text',
      'browser_close_session',
      -- Phase F: キャンセル
      'cancel_command'
    )
  );

COMMENT ON CONSTRAINT agent_commands_type_check ON agent_commands IS
  'Phase F (2026-05-27) で Claude Code 級の自由実行コマンドを許可: file_*, browser_*, cancel_command';
