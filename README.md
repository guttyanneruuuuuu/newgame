# BALL DASH ROYALE

3Dボール転がしのオンライン対戦レースゲーム。最大6人まで同じ部屋に入って、ジャイロ操作で迷路をかけぬけ、ゴールの穴に最初に落ちた人が勝ちです。

## 🎮 特徴

- **3D迷路レース**: Three.js + Cannon-es 物理エンジンによるリアルな転がりと衝突
- **三人称視点**: ボールのすぐ後ろからの低い視点で迷路感を演出
- **ジャイロ操作**: スマホを傾けるだけで直感的に操作（奥を下げると画面の上へ進む）
- **オンライン対戦**: PeerJS による合言葉ベースのP2Pマッチ。最大6人
- **CPU対戦**: BFS経路探索のCPUと対戦可能。スキル調整あり
- **カスタマイズ**: 名前と16色からボールカラーを選択
- **アイテム**: 黄色のリングを取るとブースト
- **明るいデザイン**: ネオン系を排した、空・草原テイストの陽気なビジュアル

## 🕹 操作

### スマホ
- スマホを左右に傾ける → 左右に転がる
- スマホの**奥を下げる** → 画面の**上**へ進む（リクエスト通り反転済み）
- スマホの手前を下げる → 画面の下に進む

### PC
- WASD / 矢印キー: 移動
- スペース: ジャンプ（実装予定）

## 🚀 デプロイ

`main` ブランチへのpushで GitHub Pages に自動デプロイされます。

公開URL: https://guttyanneruuuuuu.github.io/newgame/

## 📋 技術スタック

- Three.js (3Dレンダリング)
- Cannon-es (物理シミュレーション)
- PeerJS (WebRTC P2P通信)
- DeviceOrientationEvent (ジャイロ)

## 🛠 ローカル実行

```bash
git clone https://github.com/guttyanneruuuuuu/newgame.git
cd newgame
python3 -m http.server 8000
# http://localhost:8000 をブラウザで開く
```

## 📜 ライセンス

MIT
