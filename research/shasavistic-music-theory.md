# シャサフ式音楽理論の概要

この文書はシャサフ式音楽理論の概要をまとめた参考資料であり、要求正本・設計・検証計画ではない。XRiftワールドで採用する仕様や設計判断は書かない。

## 概要

- 名称はシャサフ式音楽理論、提唱者はLΛMPLIGHTである。公式の案内リストに音楽・言語の入口がまとまる。
  - 出典: 案内リスト https://lamplight0.sakura.ne.jp/a/content_list.php（確認）
  - 出典: よくある質問 https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&id=1091（確認、表記はLΛMPLIGHT、代替表記はL4MPLIGHT）
- 「シャサフ式音楽理論」は分析・構築方法、「シャサフ音楽」はLΛMPLIGHT風の作曲スタイルを指す。西洋音楽の分析や別作風の開拓にも使える。作るコツは厳格な規則ではない。
  - 出典: https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&id=1096（確認）
  - 出典: 英語版 https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&id=1097（確認、"Shasavistic music theory" と "Shasavic music" の区別）

## 基本概念

- 純正律を基礎に、和声を素数倍音の組合せとして整数比で表す。体系・記法をハラーザと呼ぶ。
  - 出典: 辞書ハラーザ https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=icsFh（確認）
- 次元は n 番目の素数倍音の乗算による和声を指す。辞書とFAQの対応は次の通り。
  - 0次元=1、1次元=2、2次元=3、3次元=5、4次元=7、5次元=11、6次元=13、7次元=17
  - 出典: 辞書次元 https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=JxizO（確認、0次元から6次元までの表）
  - 出典: よくある質問 id=1091（確認、6次元=13倍音、7次元=17倍音）
- 6次元以上の音高差は下位次元に近似できるため、耳には少しずれた下位次元として認識されやすい。提唱者は6次元以上をあまり使わない。興味があれば模索の余地がある。
  - 出典: よくある質問 id=1091（確認、例として13/8と18/11の近似への言及）
- 組成式は倍分符で周波数比を表す式で、中括弧で括ることがある。例として完全5度は2ꜛ、長3度は3ꜛである。
  - 出典: 辞書ハラーザ ic=icsFh（確認、12平均律の解釈表と微分音の表）
  - 出典: Chalaxata https://lamplight0.sakura.ne.jp/a/music/chalaxata.php（確認、格子表示に組成式と比が並ぶ）

## 主要な記法と概念

- ハーモニムは倍分組成に付けた名で、命名はハラーザに従う。
  - 出典: 辞書 https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=BoUl0（確認）
- コードニムは和音図の読み方で、構成音を低次元から高次元などの順序で列挙する。
  - 出典: 辞書和音 https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=r2CMa（確認、列挙順序と例）
- 和音図はハラーザに基づく和音の構造図である。具体例は和音の頁にまとまる。
  - 出典: 辞書 https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=il3gM（確認）
- 機能式は主和音との位置関係による和音の役割を中括弧で表す。例として [0]、[1]、[-1] がある。
  - 出典: 辞書 https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=E8tw5（確認）
- トネッツは音程関係の格子状の図という一般的な意味でのみ触れる。公式での位置づけは未確認であり、未確認節に分ける。
- 親等は2音の関係に必要な上下回数である。1親等以下を近親音、2親等以上を遠戚音と呼ぶ。
  - 出典: 辞書 https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=IC7Mz（確認）
- 底音は最低音の現行表記、基準音は和音図の下の ! や戻る記号で扱う音、主音は音階の基準となる音である。
  - 出典: よくある質問 id=1091（確認、!・戻る記号・変化なし・主始記法の説明）
  - 出典: 変更点 https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&id=1107（確認、底音表記の統一と基準音 Ah への統一）
  - 出典: 作るコツ id=1096（確認、主音の説明）
- 主始記法は主音からの音高差を明示する書き方、前始記法は直前の底音からの音高差で書く書き方である。記法名の整理は変更点一覧にある。
  - 出典: よくある質問 id=1091（確認、Caftaphata での使い分け）
  - 出典: 変更点 id=1107（確認、基記法から始記法への変更）
- ハラーザは素数倍音中心の記法・体系、クカーザは12平均律の五度圏に基づく階名記法である。
  - 出典: 辞書ハラーザ ic=icsFh（確認、クカーザへの参照を含む）
  - 出典: 辞書 https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=UMU4N（確認）

## 音律

- 12平均律の音高差をハラーザで近似解釈する表が辞書にある。妥協を強調する場合は倍分符の前に印を加える。
  - 出典: 辞書ハラーザ ic=icsFh（確認、3次元限界の解釈表）
- コンマは計算方法の違いによる微小なずれである。シントニックコンマ 81/80 に対応する Ama 形がある。
  - 出典: 辞書 https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=At1u2（確認、Cvachys Ama の記載）
- 31平均律や41平均律は作例・二次資料に見えるが、理論の公式規定としては断定しない。未確認節に分ける。

## 制作環境

- Chalaxata は公式の微分音アプリで、格子などの方式で和音や進行を試せる。用語は辞書で解説する。
  - 出典: https://lamplight0.sakura.ne.jp/a/music/chalaxata.php（確認）
  - 出典: よくある質問 id=1091（確認、Chalaxata とハーモニム作成機への言及）
- Nafchanaphata は Rtt による非公式の Web シーケンサーで、和音図を拡張した表示で編集・再生する。公式の非公式アプリ一覧に載る。実装の詳細は二次情報として扱う。
  - 出典: https://lamplight0.sakura.ne.jp/a/articles/articles_iframe.php?writer=lamp&id=1106（確認、一次による非公式扱いの根拠）
  - 出典: https://github.com/Rtt398/nafchanaphata（確認、二次、README の説明）

## 用語対応表

確実に一次で確認できた語だけ載せる。辞書の英語欄に注意記号が付く語があり、英語名は暫定的な場合がある。

| 日本語 | 沙語 | 英語 | 出典 |
|---|---|---|---|
| 次元 | lycás | dimension | https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=JxizO |
| 和音 | náfcha | chord | https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=r2CMa |
| 和音図 | Nafchálica | chord diagram | https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=il3gM |
| ハーモニム | taviacóiza | harmononym | https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=BoUl0 |
| ハラーザ | Chaláxa | Chalaxa | https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=icsFh |
| クカーザ | Cucáxa | Cucaxa | https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=UMU4N |
| 機能 | pasmóc | function | https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=E8tw5 |
| 親等 | cluirkýx | kinness | https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=IC7Mz |
| コンマ | vaglýnna | comma | https://lamplight0.sakura.ne.jp/a/langs/saf_sdic_iframe_wordpage.php?ic=At1u2 |

## 出典と確認状態

- 取得日は 2026-09-24、確認方法はレンダラ経由の本文取得である。公式サイトは JS 依存のため直接取得では空になる場合があり、レンダラ経由で読んだ。
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
| 辞書9頁（次元・ハラーザ・ハーモニム・和音・和音図・機能・クカーザ・親等・コンマ） | 上の各 ic への URL | 本文取得、確認 |
| 用語一覧 | https://lamplight0.sakura.ne.jp/a/misc/term_list.php?field=%E9%9F%B3%E6%A5%BD | 一覧のみ取得、個別定義は未取得 |

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
- 動画本編の内容は未確認である。理論プレイリストの存在は一次で確認したが、視聴はしていない。
- トネッツの公式定義は未確認である。本文では一般概念としてのみ触れる。
- 31平均律と41平均律の公式規定としての位置づけは未確認である。作例や二次記事の言及にとどめる。
- 倍音・音高差・底音・基準音・主音・シャサフ語などの沙語綴りは今回の一次取得で確定しないため、対応表に載せない。
- gist と note 記事の内容は未取得のため、二次情報として確定させない。
