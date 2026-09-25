---
description: "/intent: 要求正本にある要求文書の作成・更新・確認"
agent: orchestrator
---

# `/intent`

requirements/intent/にある要求文書の作成、更新、確認を行う。

- requirements/AGENTS.mdとrequirements/vision.mdを先に読む。
- 手段や内部構造は要求文書へ書かず、達成したい状態と保つべき条件を書く。
- 関連する要求文書との重複や矛盾を確認する。
- 具体的な要求変更は人間が判断する。Designで要求を補って確定しない。
- Designへの影響はworkflow配下の設計との参照関係として確認する。

一覧や状況の確認ではファイルを変更しない。作成または変更後は`.agents/skills/intent-review/SKILL.md`に従ってレビューする。
