# ADD SDK 中文接入说明

**0.2.0** 支持当前新 V1 的 BSC、Ethereum 两条链，以及质押 V2、每币独立分红。提供 SDK 自身源码、TypeScript 类型、ESM、CommonJS 和示例。只读取链上数据、生成未签名交易，不保存私钥，不请求签名，不广播。

- BSC：chainId **56**，原生币 BNB，毕业进入 PancakeSwap V2。
- Ethereum：chainId **1**，原生币 ETH，毕业进入 Uniswap V2。
- 新 V1 用 `AddV1Client`；原 `AddClient` 保留旧 BSC v12/v13。不能只换地址复用旧 ABI。

[平台文档](https://add.fun/docs/zh/) · [英文 API](https://add.fun/sdk/reference.html) · [GitHub](https://github.com/ADDfunLabs/add-sdk)

## 安装

Node.js 20 以上。当前从官网和 GitHub 分发，**尚未发布到 npm 注册表**。

```sh
npm install https://add.fun/sdk/releases/add-fun-sdk-0.2.0.tgz
```

对照 [发布清单](https://add.fun/sdk/release.json) 或包旁 `.sha256` 核验版本、SHA-256、npm integrity 和包内文件。可信合约绑定不能取自任意代币介绍。

## 快速使用

```ts
import { JsonRpcProvider, parseEther } from 'ethers';
import { AddV1Client } from '@add-fun/sdk';

const add = new AddV1Client(new JsonRpcProvider(RPC_URL), { chainId: 56 });
const token = await add.readToken(TOKEN_ADDRESS);
if (token.phase === 'active' && token.reviewed) {
  const quote = await add.quoteBuy(token.token, parseEther('0.01'));
  const request = await add.buildTrade(quote, WALLET_ADDRESS, {
    deadline: BigInt(quote.timestamp + 300), slippageBps: 50,
  });
  await add.simulate(request);
  // 应用向钱包展示参数，用户确认后签名发送；SDK 不发交易。
}
```

ETH 使用 `{ chainId: 1 }` 和 ETH 节点。钱包连接、切链、确认和发送由应用负责。模拟只反映某个区块，不保证后续一定成交。

## 单位与报价

所有金额用 `bigint` 最小单位，不用浮点数计算。BNB、ETH 为 18 位，发行币按自身精度，`reserve`、`quoteTarget` 按 `quoteDecimals`。两链 USDT 精度不能视为相同。目标/创建输入的 `ZeroAddress` 表示原生币；WBNB/WETH 是 ERC20，不是原生币授权对象。

关联调用固定同一编号区块并核验哈希。构建交易只接受**同一实例发出的原始冻结报价**，不能复制或 JSON 恢复后使用。区块时间超过 120 秒须重报；deadline 晚于当前区块且不超过 15 分钟。

普通滑点 `slippageBps` 为 0～1000 整数，默认 50，即 0.5%。剩余库存购买另有 0～300 BPS 付款缓冲，默认 3%。最后多付原生币由 Portal 退买家。构建时检查最新阶段、余额、授权和价格边界，保留原输入/最低输出，不会自动切去外盘。卖出/退款先确认精确数量授权，再重新读取并模拟后续交易。

## 公开接口

### 新 V1 内盘

- `new AddV1Client(provider, { chainId, deployment? })`：显式选链，默认固化运行字节码、工厂和模板。完整自定义部署仅用于另行审核或本地测试，不接受任意用户元数据作为可信绑定。
- `readToken(token, { blockTag? })`：名称、库存、募集资产/目标、储备、阶段、工厂/创建者/交易对、当前收费地址。未知外部池可以只读，资金操作拒绝未经审核的机制。
- `getLaunchTarget(quoteAsset?, { targetNative?, blockTag? })`：当前目标与募集币数量，已创建项目仍用自己的锁定参数。
- `quoteBuy`、`quoteSell`、`quoteRemainingBuy`、`quoteRefund`：买入输入原生币；卖出/退款输入发行币，退款输出原募集资产。
- `buildTrade(quote, account, { deadline, slippageBps? })`：买、卖或退款；`buildSwap`、`buildRefund` 为专用入口。
- `buildApproval(token, account, amount)`、`readAllowance(token, account, options?)`：向选定 Portal 授权指定数量并读取余额/授权。
- `simulate(request)`：只模拟本实例生成且未改动的请求，不支付 Gas、不广播。
- `decodePortalLog(log)`、`getPortalEvents(fromBlock, toBlock)`：固化 Portal 事件，单次最多 2000 个区块；节点可能要求更小范围。

### 税收和分红

- `readTax(token, options?)`：固定买卖税和四项分配、登记分红/矿池、门槛与待处理余额。
- `buildProcessTaxes(token, account)`：毕业后公开处理入口，仍受门槛、价格和执行条件限制，不保证每次即时分发。
- `readDividend(token, { account?, blockTag? })`：独立分红账本、奖励币、最低持币和个人可领。
- `buildDividendClaim(token, gasPayer, { unwrapNative?, holder? })`：本人领取或替 holder 支付 Gas 领取；替领不能更换收款人，原生奖励以包装币给持有人。只有本人原生奖励领取可选择解包。

### 质押 V2

- `readStakingPool(pool, { account?, blockTag? })`：核验工厂/精确 clone，查看资产、周期、产出、账户和本金锁仓。税入矿池未毕业时明确等待状态。
- `readStakingPositions(pool, account, { offset?, limit?, blockTag? })`：分页查看独立质押批次。
- `readStakingAllowance`、`buildStakingApproval`：`purpose: 'stake' | 'fund'` 区分本金/奖励，仅授权指定数量给核验矿池。原生币无需 ERC20 授权。
- `buildStake(pool, account, amount, { minimumReceived? })`：本金按实际到账计算，可选最低到账默认 0。
- `buildWithdraw(pool, account, amount, { receiver?, unwrapNative? })`：只取已解锁本金，本金不收平台费。
- `buildStakingClaim(pool, account, { receiver?, wrappedReward? })`：奖励币扣固定 1% 维护费。
- `buildCheckpoint(pool, account)`：同步新增循环奖励/关联激活。需要激活的池先确认 checkpoint，再重读最终 LP/奖励绑定后质押。
- `previewAddRewards(pool, assumedReceived, 'extend' | 'recalculate', options?)`、`buildAddRewards(pool, account, amount, { mode?, minimumReceived? })`：按池类型追加预付/循环奖励。预计到账不是实际到账承诺。

导出类型、`V1_DEPLOYMENTS` 和公开 ABI。使用 `*_ABIS[chainId]` 对应链字段，`*_ABI` 是 BSC 别名。业主、初始化和内部自调用写函数不纳入 SDK。裸 ABI 不等于完整托管创建流程。

## 当前合约与机制

- BSC 新 V1 Portal：`0x933bc9fe78c9beaedc5a82bd24b5359d01e8fd7b`，起始区块 `125996705`。默认参考 **4 BNB** 为此部署常量，没有修改默认目标函数。
- ETH 新 V1 Portal：`0x5247dD1586923176bF92FeA99aadD21cEDDbA0e5`，起始区块 `26139958`。初始默认 **1 ETH**，业主能改后续新项目默认值。
- 当前标准、税收、税入矿池工厂两链独立绑定；质押只接当前 V2，停用 V1 不是新建模板。

Portal 按实际收到发行币一半募集、一半加池。兑换比例相对募集币固定；剩余未售库存严格小于接入总量 1% 时尝试毕业，使用实际募集资产，不必凑满参考目标。最后多付原生币退买家。内盘实际结算收 1% 原生币费用，0 转账税不免此费。

毕业失败保留最后成交、暂停内盘并保护储备。任何人可重试原池；业主可尝试受报价界限保护的备用换池，或永久开启按比例交币退款，返原募集资产，已收交易费不退。业主只能提**未受保护多余资产**，不能提募集/退款储备；仍管理工厂准入、新建开关和业主交接。删除工厂不影响已登记项目。旧 v12/v13 权限不同。

毕业后买卖税固定，钱包互转免税，税币累计后由符合条件的卖出/公开处理执行。税入矿池使用营销分配，不额外加第五项税。分红、质押奖励由用户领取；质押 V2 无业主、不可升级、无资产救援提取入口。[权限](https://add.fun/docs/zh/permissions/)。

## 事件、旧版和边界

新 V1 事件名/单位不同于旧 `BuyEvent`、`TokenSaleCreated`、`swapExactInput`，按链选 ABI，仅处理成功回执，按 `(chainId, transactionHash, logIndex)` 去重、保留区块哈希、处理 removed/重组。SDK 不运行持久索引、数据库、节点或保证最终确认。

原 `AddClient` 保留 BSC 三个 v12/v13 Portal，主地址 `0xf58b88C2C263e49737BA92a73D3F5d53480Bd0d4`。旧阶段 `launch`、费用 `feeBNB`、事件查询 `(portal, fromBlock, toBlock)`；新 V1 为 `active`、`nativeFee`、`(fromBlock, toBlock)`。BSC 旧 `0x5247…` 与 ETH 新 V1 地址相同但链/字节码/ABI 不同，不能仅凭地址判链。0.1.0 原包保持不变。

资料签名/图片上传、vanity 盐搜索预留、业主管理和外盘 DEX 交易不在自动流程。rebase、reflection、转账方额外扣款资产不宣传支持。字节码核对和本地测试不等于第三方独立审计。

## 错误与构建

`AddSdkError.code` 区分 `WRONG_CHAIN`、`CODE_MISMATCH`、`BINDING_MISMATCH`、`BLOCK_CHANGED`、`UNREGISTERED_TOKEN`、`INVALID_QUOTE`、`STALE_QUOTE`、`INVALID_DEADLINE` 等检查，ethers/节点错误也可能透传。失败时显示真实原因，需要时重报确认，不变成零价格或自动发替代交易。

```sh
npm install --ignore-scripts
npm test
npm pack
```

独立解压源码包可安装开发依赖后构建测试；私有项目使用锁文件并运行 `node scripts/sync-sdk.cjs --check`，另有真实 Solidity 本地 EVM 集成测试。公开包只有 SDK 自身源码、接口和公开部署绑定，不含平台前后端、Solidity 实现、私密配置或密钥。

## 创建接口

只生成当前已核验工厂的**未签名**请求，不自动搜索 vanity 盐、预留地址、上传图片资料、签名或首次买入。

- `readCreationDomain(mechanismId, options?)`、`predictToken(mechanismId, salt, options?)`：工厂、模板、CREATE2 域和预测地址。两链 ID 为 `variable-v1`、`auto-tax-v1`、`staking-tax-v2`。
- `buildCreateToken(mechanismId, account, launch, { tax?, staking? })`：标准/税收/税入矿池发行。发行量为 18 位最小单位；bytes32 salt 前 20 字节必须是创建钱包，未占用预测地址末尾 1111。显式传募集币、当前 `targetNative` / `quoteTarget`、deadline、默认/自定义模式。默认值或募集币报价变化后重新准备；可选 metadataURI 不会由此上传。
- 税率、分配以整数百分比编码成 BPS，1%=100。买卖至少一边大于 0，四项合计 10000；原生/本币奖励模式不填自定义奖励币。分红最低 10000 枚。关联质押选本币/LP/自定义本金，周期 1～360 天，矿池接营销分配。
- `buildPoolCreationApproval(account, rewardToken, amount)`：向当前单独 V2 工厂授权精确首存奖励。
- `buildCreateStakingPool(account, params)`：预付 ERC20 奖励、本金资产、产出时间、可选有限次数减半与独立本金锁仓；原生本金为 ZeroAddress，预付原生奖励使用包装币 ERC20。按实际到账入账。
- `buildCreateCyclePool(account, params)`：1～360 天循环、原生/ERC20 本金与奖励，可填 0 首存。原生首存用 value，ERC20 首存需授权工厂。

所有涉及转入 ERC20 的资金请求均要求**先确认精确授权，再构建并模拟资金交易**。授权允许填 0 清零/撤销，USDT 等可能需要先清零再授权；Gas 预算另留。税处理请求设置 3500000 Gas 上限，满足合约起始 Gas 条件；这是上限，不是实际消耗。

```ts
import { ZeroAddress, parseUnits } from 'ethers';

// PREPARED_SALT 由独立的创建者绑定 vanity 准备流程提供。
const expectedAddress = await add.predictToken('variable-v1', PREPARED_SALT);
const target = await add.getLaunchTarget(ZeroAddress);
const creation = await add.buildCreateToken('variable-v1', WALLET_ADDRESS, {
  name: 'Example', symbol: 'EX', supply: parseUnits('1000000', 18),
  salt: PREPARED_SALT, expectedAddress, quoteAsset: ZeroAddress,
  targetNative: target.targetNative, quoteTarget: target.quoteTarget,
  deadline: BigInt(target.timestamp + 300), customTarget: false,
});
await add.simulate(creation);
// 应用另外请求用户钱包确认和提交。
```

[公开绑定清单](https://add.fun/sdk/deployments.json) 列出 SDK 该版本审核的两链 Portal、工厂、模板和矿池绑定，不是任意替换后仍可信的授权。买入请求设 6000000 Gas 上限以容纳毕业尝试，实际消耗可能更低。
