# シャサフ式音楽理論の概要

この文書はシャサフ式音楽理論の概要をまとめた参考資料であり、要求正本・設計・検証計画ではない。XRiftワールドで採用する仕様や設計判断は書かない。

シャサフ式音楽理論の用語・記法の正本は `.agents/skills/shasavistic-music-theory/` である。用語の詳細・出典はSkillを参照すること。

## 出典と確認状態

- 一次情報は LΛMPLIGHT の公式サイトと辞書、二次情報は第三者の実装や記事である。

### 一次情報

| 資料 | URL | 状態 |
|---|---|---|
| 案内リスト | https://lamplight0.sakura.ne.jp/a/content_list.php | 本文取得、確認 |
| よくある質問 | https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&id=1091 | 本文取得、確認 |
| 作るコツ日本語版 | https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&id=1096 | 本文取得、確認 |
| 作るコツ英語版 | https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&id=1097 | 本文取得、確認 |
| 主要な変更点 | https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&id=1107 | 本文取得、確認 |
| 非公式アプリ一覧 | https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&id=1106 | 本文取得、確認 |
| 音楽用語まとめ | https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&answer=4&id=4 | 本文取得、用語索引として確認 |
| Chalaxata | https://lamplight0.sakura.ne.jp/a/music/chalaxata.php | 本文取得、確認 |
| 用語一覧 | https://lamplight0.sakura.ne.jp/a/misc/term_list.php?field=%E9%9F%B3%E6%A5%BD | Skillに収録済み（255語、取得日 2026-09-25） |
| 辞書の音楽分野255頁 | 各 `https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=<id>` | Skillに収録済み（抽出成功255、失敗0） |
| 辞書9頁（次元・ハラーザ・ハーモニム・和音・和音図・機能・クカーザ・親等・コンマ） | 上の各 ic への URL | 本文取得、確認 |
| 動画「[微分音解説] 音階の作成 (和音転写･使用ソフト)」 | https://www.youtube.com/watch?v=q8A7utFpS9E | 投稿者 LΛMPLIGHT、公開日 2025-02-01、長さ 728秒。日本語自動字幕と公式シャサフ語字幕を取得して確認。該当箇所 02:07–03:51・03:43–03:51・06:20–07:33 |

- 上の動画は日本語自動字幕と公式シャサフ語字幕で確認した。映像・音声の本編は未確認である。一時ファイル（`shasavistic-music-lab/tmp/yt-q8A7utFpS9E/`）を恒久保存の前提にせず、一次URLとタイムコード・字幕種別を記録する。
- 用語は公式シャサフ語字幕を正とし、日本語自動字幕は補助として扱う。
- 動画は音階の由来の説明を「解釈の一つ」と留保している。

### 二次情報

| 資料 | URL | 状態 |
|---|---|---|
| Nafchanaphata リポジトリ | https://github.com/Rtt398/nafchanaphata | 本文取得、README の説明を確認 |
| Nafchanaphata util.js | https://raw.githubusercontent.com/Rtt398/nafchanaphata/main/js/util.js | 本文取得、周波数比の値は実装者の選択として扱う |
| HaleyHalcyon の gist | 素材の記載のみ | 未取得、未確認節に置く |
| note 記事 | 検索で存在のみ確認 | 未取得、未確認節に置く |

- Nafchanaphata の `js/util.js` の周波数比（例として 5d=11/4、6d=13/4、7d=17/4 など）は実装者が独自に解釈した値であり、理論の公式規定として断定しない。
- 公式資料の範囲では、辞書ハラーザの表は6次元まで、7次元=17の対応はFAQで確認できる。食い違いではなく範囲の違いとして残す。

## 未確認事項

- Nafchanaphata の語義は未確認である。README に語義の説明は見つからない。
- 5d以上の周波数比の正規値は未確認である。7d=17の対応はFAQで確認したが、比の正規表は取得できていない。
- 動画本編の映像・音声は未確認である。理論プレイリストの存在は一次で確認したが、視聴はしていない。上の動画一本は日本語自動字幕と公式シャサフ語字幕で確認した。
- トネッツの公式定義は未確認である。
- 31平均律と41平均律の公式規定としての位置づけは未確認である。作例や二次記事の言及にとどめる。
- 倍音・音高差・底音・基準音・主音・シャサフ語などの沙語綴りは今回の一次取得で確定しない。
- gist と note 記事の内容は未取得のため、二次情報として確定させない。
