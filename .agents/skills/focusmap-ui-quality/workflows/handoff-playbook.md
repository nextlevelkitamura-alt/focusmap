# Handoff Playbook

Use this so a non-engineer can run the workflow without guessing what to paste where.

## Simple Rule

Do not send all prompts at once.

```text
1. Send Chat 1: Design Pack only.
2. Wait for "Chat 1完了".
3. Review the proposal and visible mockup images.
4. Send Chat 2: Implementation Orchestrator only after approval.
5. Chat 2 creates worker prompts and stops.
6. Run foundation worker first if Chat 2 says so.
7. Run detail workers only after the foundation base commit is known.
8. Paste all worker reports back to Chat 2.
9. Chat 2 integrates to local main.
10. Push/deploy only after explicit approval.
```

For P0 white screen or client exception, use `fast-triage` instead. Do not wait for mockups to restore a broken app.

## Next Chat Handoff Block

Every handoff must use this shape:

````md
## Next Chat Handoff

次に送るチャット:
<Chat 1: Design Pack | Chat 2: Implementation Orchestrator | Implementation Worker | Integration Finalizer>

目的:
<1文で説明>

貼るもの:
- <screenshot/appshot path>
- <proposal path>
- <mockup image path>
- <worker report>

そのまま貼るプロンプト:
```md
<paste-ready prompt>
```

そのチャットから返してほしいもの:
- ...

まだやらないこと:
- ...
````

## Good Prompt Checklist

- Skill name and mode are clear.
- Role is clear.
- Repo path is clear.
- Target screen and platform are clear.
- Read-first files are listed.
- Allowed files and forbidden files are listed for implementation.
- Stop point is explicit.
- Push/deploy is explicitly forbidden unless approved.
- Tests and browser checks follow repo policy.
- Final report format is explicit.
