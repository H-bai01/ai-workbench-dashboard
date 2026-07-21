<template>
  <div class="dashboard" data-system-version="2.0">
    <!-- ========= 1. 顶部状态栏 ========= -->
    <header class="status-bar">
      <div class="status-bar-inner">
        <div class="brand">
          <el-icon :size="24" class="brand-icon"><Monitor /></el-icon>
          <div class="brand-copy">
            <h1 class="brand-title">
              <span class="brand-name">AI 工作台总控</span>
              <span class="brand-version">v{{ displayVersion }}</span>
              <span v-if="isBeta" class="brand-channel">内测</span>
            </h1>
          </div>
          <span class="brand-time">{{ currentTime }}</span>
        </div>

        <!-- 顶部右侧：版本 + 网关 + 通知 + 自定义布局 -->
        <div class="status-top-right">
          <!-- 版本 -->
          <div class="top-control-slot" :style="{ order: topBarControlOrder('version') }">
            <el-tooltip :content="openClawUpdateTooltip" placement="bottom">
              <button
                class="top-indicator top-indicator-version"
                :class="{ 'has-update': openClawUpdateAvailable }"
                @click="versionDialogVisible = true"
              >
                <el-icon :size="13"><Box /></el-icon>
                <span class="top-ind-label">{{ openClawUpdateAvailable ? 'OpenClaw 可更新' : 'OpenClaw 版本' }}</span>
                <span class="top-ind-value mono">{{ openClawVersionDisplay }}</span>
                <span v-if="openClawUpdateAvailable" class="version-update-badge">更新</span>
              </button>
            </el-tooltip>
          </div>

          <!-- 网关健康 -->
          <div class="top-control-slot" :style="{ order: topBarControlOrder('gateway') }">
            <el-tooltip content="诊断功能暂时停用" placement="bottom">
              <button class="top-indicator" :class="`top-indicator-${store.healthStatus}`" @click="showSealedFeature('诊断功能')">
                <el-icon :size="13"><component :is="healthIcon" /></el-icon>
                <span class="top-ind-label">网关</span>
                <span class="top-ind-value">{{ healthDisplay }}</span>
              </button>
            </el-tooltip>
          </div>

          <!-- 通知中心 -->
          <div class="top-control-slot" :style="{ order: topBarControlOrder('notifications') }">
            <el-popover v-model:visible="notificationPopoverVisible" placement="bottom-end" :width="360" trigger="click" popper-class="notif-popper">
              <template #reference>
                <button class="top-indicator top-indicator-notif" :class="{ 'has-unread': store.unreadNotifications > 0 }">
                  <el-icon :size="13"><Bell /></el-icon>
                  <span class="top-ind-label">通知中心</span>
                  <span class="top-ind-value">{{ store.unreadNotifications > 0 ? `${store.unreadNotifications} 条未读` : '无新通知' }}</span>
                  <span v-if="store.unreadNotifications > 0" class="top-notif-badge">{{ store.unreadNotifications > 9 ? '9+' : store.unreadNotifications }}</span>
                </button>
              </template>
              <template #default>
                <div class="notif-panel">
                  <div class="notif-header">
                    <span>通知中心</span>
                    <div class="notif-actions">
                      <el-button link size="small" @click="store.markAllNotificationsRead()" :disabled="store.unreadNotifications === 0">全部已读</el-button>
                      <el-button link size="small" type="danger" @click="store.clearNotifications()" :disabled="store.notifications.length === 0">清空</el-button>
                    </div>
                  </div>
                  <div v-if="store.notifications.length === 0" class="notif-empty">
                    <el-icon><BellFilled /></el-icon>
                    暂无通知
                  </div>
                  <div v-else class="notif-list">
                    <button
                      v-for="n in store.notifications"
                      :key="n.id"
                      type="button"
                      class="notif-item"
                      :class="[`notif-${n.type}`, { unread: !n.read }]"
                      :aria-label="`查看${n.agentName}通知详情`"
                      @click="openNotificationDetail(n)"
                    >
                      <span class="notif-icon">{{ n.type === 'error' ? '!' : n.type === 'aborted' ? '-' : 'i' }}</span>
                      <div class="notif-body">
                        <div class="notif-agent">{{ n.agentName }}</div>
                        <div class="notif-msg">{{ n.message }}</div>
                        <div class="notif-time">{{ formatNotifTime(n.timestamp) }}</div>
                      </div>
                      <span class="notif-open-hint">查看详情</span>
                    </button>
                  </div>
                </div>
              </template>
            </el-popover>
          </div>

          <!-- Sprint 7: 全局搜索 cmd+K -->
          <div class="top-control-slot" :style="{ order: topBarControlOrder('search') }">
            <el-tooltip content="全局搜索（⌘K）" placement="bottom">
              <button class="top-indicator top-indicator-search" @click="commandPaletteVisible = true">
                <el-icon :size="13"><Search /></el-icon>
                <span class="top-ind-label">搜索</span>
                <kbd class="top-ind-kbd">⌘K</kbd>
              </button>
            </el-tooltip>
          </div>

          <!-- Sprint 9: #18 主题切换（Dark/Light Theme Toggle）-->
          <div class="top-control-slot" :style="{ order: topBarControlOrder('theme') }">
            <el-tooltip :content="isDark ? '切换亮色主题' : '切换暗色主题'" placement="bottom">
              <button class="top-indicator top-indicator-theme" @click="toggleTheme">
                <el-icon :size="13" class="theme-icon"><component :is="isDark ? Sunny : Moon" /></el-icon>
                <span class="top-ind-label">{{ isDark ? '亮色' : '暗色' }}</span>
              </button>
            </el-tooltip>
          </div>

          <!-- 自定义布局 -->
          <div class="top-control-slot" :style="{ order: topBarControlOrder('layout') }">
            <el-tooltip content="自定义布局：排序页面模块 / 顶栏工具 / 功能入口" placement="bottom">
              <button class="top-layout-btn" @click="layoutDialogVisible = true">
                <el-icon :size="14"><Operation /></el-icon>
                <span>自定义布局</span>
              </button>
            </el-tooltip>
          </div>
        </div>
      </div>
    </header>

    <!-- ========= 2. 指挥舱：Token + Agent 工作状态 ========= -->
    <section
      class="cockpit-section"
      :style="{ order: pageModuleOrder('cockpit') }"
    >
      <div class="scope-toolbar">
        <div class="scope-toolbar-main scope-toolbar-panel">
          <span class="scope-control-label">时间范围：</span>
          <el-date-picker
            v-model="tokenMiniCustomRangeDraft"
            class="token-mini-custom-range"
            :class="{ active: tokenMiniRange === 'custom' }"
            type="daterange"
            unlink-panels
            clearable
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="起始日期"
            end-placeholder="截止日期"
            popper-class="token-mini-date-range-popper"
            @change="setTokenMiniCustomRange"
          />
          <div class="scope-control-group token-mini-ranges" aria-label="全局时间范围">
            <button
              v-for="opt in TOKEN_MINI_RANGES"
              :key="opt.value"
              class="token-mini-chip"
              :class="{ active: tokenMiniRange === opt.value }"
              type="button"
              @click="setTokenMiniRange(opt.value)"
            >{{ opt.label }}</button>
          </div>
          <span
            v-if="(tokenUsageSnapshotLoading || tokenUsageSnapshotServerRefreshing) && tokenUsageSnapshotReady && !tokenUsageSnapshotBlocking"
            class="usage-snapshot-refreshing"
            role="status"
          ><i aria-hidden="true"></i>正在后台更新…</span>
        </div>
        <div class="scope-toolbar-controls scope-toolbar-panel">
          <span class="scope-control-label">显示内容：</span>
          <div class="scope-control-group token-mini-metrics" aria-label="全局指标">
            <button
              class="token-mini-chip metric-chip"
              :class="{ active: tokenMiniMetricKeys.includes('tokens') }"
              type="button"
              @click="toggleTokenMiniMetric('tokens')"
            >Token</button>
            <button
              class="token-mini-chip metric-chip"
              :class="{ active: tokenMiniMetricKeys.includes('cost') }"
              type="button"
              @click="toggleTokenMiniMetric('cost')"
            >API 等价费用</button>
          </div>
          <button
            v-if="hasTokenMiniModelFilter"
            class="token-mini-chip clear-chip"
            type="button"
            @click="tokenMiniSelectedModels = []"
          >全部模型</button>
        </div>
      </div>
      <div
        class="cockpit-inner"
        :class="{ 'has-expanded-summary': modelShareExpanded || contributionExpanded }"
        v-loading="tokenUsageSnapshotBlocking"
        element-loading-text="正在汇总完整统计…"
      >
        <article
          class="cockpit-card token-cockpit-card"
          :class="{
            'token-cockpit-card--few-models': modelShareRows.length <= 2,
            'token-cockpit-card--three-models': modelShareRows.length === 3,
            'token-cockpit-card--many-models': modelShareRows.length > 3,
          }"
          role="button"
          tabindex="0"
          @click="openTokenDetail()"
          @keydown.enter="openTokenDetail()"
        >
          <div class="cockpit-card-header">
            <div>
              <div class="cockpit-eyebrow">{{ tokenMiniMetricLabel }} 总览</div>
            </div>
            <el-icon :size="24"><Odometer /></el-icon>
          </div>
          <div class="token-kpi-row">
            <div>
              <span>API 等价美元</span>
              <strong
                :title="`按 1 USD = ¥${USD_TO_CNY_RATE} 估算`"
                :style="{ color: tokenMiniMetric === 'cost' || tokenMiniMetric === 'both' ? COST_METRIC_COLOR : undefined }"
              >{{ tokenUsageSnapshotReady ? scopedUsdText : '—' }}</strong>
            </div>
            <div>
              <span>API 等价人民币</span>
              <strong :style="{ color: tokenMiniMetric === 'cost' || tokenMiniMetric === 'both' ? COST_METRIC_COLOR : undefined }">{{ tokenUsageSnapshotReady ? scopedCostText : '—' }}</strong>
            </div>
            <div>
              <span>当前 Token</span>
              <strong :style="{ color: tokenMiniMetric === 'tokens' || tokenMiniMetric === 'both' ? TOKEN_METRIC_COLOR : undefined }">{{ tokenUsageSnapshotReady ? scopedTokenText : '—' }}</strong>
            </div>
          </div>
          <div
            class="token-mini-chart"
            v-loading="tokenMiniLoading"
            @click.stop
            @mousemove="handleTokenMiniChartMove"
            @mouseleave="clearTokenMiniHover"
          >
            <div class="token-mini-chart-head">
              <span>{{ tokenMiniRangeLabel }} · {{ tokenMiniMetricLabel }}</span>
              <div class="token-mini-chart-metrics" aria-label="图表显示内容">
                <button
                  class="token-mini-chart-chip"
                  :class="{ active: tokenMiniMetricKeys.includes('tokens') }"
                  type="button"
                  @click="toggleTokenMiniMetric('tokens')"
                >Token</button>
                <button
                  class="token-mini-chart-chip"
                  :class="{ active: tokenMiniMetricKeys.includes('cost') }"
                  type="button"
                  @click="toggleTokenMiniMetric('cost')"
                >API 等价费用</button>
              </div>
            </div>
            <div class="token-mini-plot" ref="tokenMiniPlotEl" v-if="tokenMiniChartPoints.length > 0">
            <svg
              class="token-mini-svg"
              :viewBox="`0 0 ${TOKEN_MINI_SVG_W} ${TOKEN_MINI_SVG_H}`"
              preserveAspectRatio="none"
            >
              <line
                v-for="line in tokenMiniGridLines"
                :key="line"
                :x1="TOKEN_MINI_PAD_L"
                :y1="line"
                :x2="TOKEN_MINI_SVG_W - TOKEN_MINI_PAD_R"
                :y2="line"
                stroke="var(--border-color)"
                stroke-width="1"
              />
              <path
                v-for="series in tokenMiniChartSeries"
                :key="`${series.key}-area`"
                :d="series.areaPath"
                :fill="series.color"
                :opacity="tokenMiniMetric === 'both' ? 0.05 : 0.08"
              />
              <path
                v-for="series in tokenMiniChartSeries"
                :key="`${series.key}-line`"
                :d="series.linePath"
                fill="none"
                :stroke="series.color"
                :stroke-width="tokenMiniMetric === 'both' ? 2.1 : 2.35"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <template v-for="series in tokenMiniChartSeries" :key="`${series.key}-dots`">
                <circle
                  v-for="(pt, index) in series.points"
                  v-show="tokenMiniChartPoints.length <= 32 || index === 0 || index === series.points.length - 1"
                  :key="`${series.key}-${pt.date}`"
                  :cx="pt.x"
                  :cy="pt.y"
                  r="2.7"
                  :fill="series.color"
                  stroke="var(--bg-primary)"
                  stroke-width="1.2"
                >
                  <title>{{ pt.date }} · {{ formatTokenMiniPointValue(series.key, pt) }}</title>
                </circle>
              </template>
              <text
                v-for="tick in tokenMiniAxisLeft"
                :key="`axl-${tick.y}`"
                class="token-mini-axis-label"
                :class="tokenMiniMetric === 'cost' ? 'is-cost' : 'is-token'"
                :x="TOKEN_MINI_PAD_L - 5"
                :y="tick.y + 3"
                text-anchor="end"
              >{{ tick.text }}</text>
              <text
                v-for="tick in tokenMiniAxisRight"
                :key="`axr-${tick.y}`"
                class="token-mini-axis-label is-cost"
                :x="TOKEN_MINI_SVG_W - 2"
                :y="tick.y + 3"
                text-anchor="end"
              >{{ tick.text }}</text>
              <g
                v-for="marker in tokenMiniPeakMarkers"
                :key="`${marker.key}-${marker.date}-${marker.rank}`"
                class="token-mini-peak"
              >
                <circle
                  :cx="marker.x"
                  :cy="marker.y"
                  r="2.9"
                  :fill="marker.color"
                  stroke="var(--bg-primary)"
                  stroke-width="1.1"
                />
                <text
                  class="token-mini-value-label"
                  :x="marker.labelX"
                  :y="marker.labelY"
                  :fill="marker.color"
                  :text-anchor="marker.anchor"
                >{{ marker.label }}</text>
              </g>
              <g v-if="tokenMiniHoverPoint">
                <line
                  :x1="tokenMiniHoverPoint.x"
                  :y1="TOKEN_MINI_PAD_T"
                  :x2="tokenMiniHoverPoint.x"
                  :y2="TOKEN_MINI_SVG_H - TOKEN_MINI_PAD_B"
                  stroke="rgba(235, 235, 245, 0.2)"
                  stroke-width="1"
                  stroke-dasharray="3 3"
                />
                <circle
                  v-for="item in tokenMiniHoverSeriesPoints"
                  :key="item.key"
                  :cx="item.point.x"
                  :cy="item.point.y"
                  r="4.2"
                  :fill="item.color"
                  stroke="var(--bg-primary)"
                  stroke-width="1.6"
                />
              </g>
              <text
                v-for="tick in tokenMiniDateTicks"
                :key="`dt-${tick.x}`"
                class="token-mini-date-label"
                :x="tick.x"
                :y="TOKEN_MINI_SVG_H - 5"
                :text-anchor="tick.anchor"
              >{{ tick.label }}</text>
            </svg>
            <div
              v-if="tokenMiniHoverPoint"
              class="token-mini-tooltip"
              :style="tokenMiniTooltipStyle"
            >
              <span>{{ tokenMiniHoverPoint.date }}</span>
              <strong
                v-for="row in tokenMiniHoverRows"
                :key="row.key"
                :style="{ color: row.color }"
              >{{ row.label }}：{{ row.value }}</strong>
            </div>
            </div>
              <div
              v-if="tokenMiniChartPoints.length === 0 && !tokenMiniLoading"
              class="token-mini-chart-empty"
            >暂无趋势数据</div>
          </div>
          <el-scrollbar
            v-if="modelShareRows.length > 0"
            class="model-share-scroll"
            :class="{
              'is-expanded': modelShareExpanded,
            }"
            :height="modelShareExpanded ? 248 : 104"
            :always="modelShareExpanded"
          >
            <div
              class="model-share-list"
              :class="{
                'model-share-list--both': tokenMiniMetric === 'both',
              }"
            >
              <button
                v-for="row in visibleModelShareRows"
                :key="row.model"
                class="model-share-row"
                :class="{
                  active: isTokenMiniModelActive(row.model),
                  muted: hasTokenMiniModelFilter && !isTokenMiniModelActive(row.model),
                  'model-share-row--both': tokenMiniMetric === 'both',
                }"
                type="button"
                :title="`${row.label} · 点击筛选 / 取消筛选`"
                @click.stop="toggleTokenMiniModel(row.model)"
              >
                <span
                  class="model-brand-mark"
                  :class="`model-brand-mark--${getModelLogoKey(row.model)}`"
                  :title="getModelCompanyName(row.model)"
                >
                  <img
                    v-if="getModelLogoSrc(row.model)"
                    class="model-brand-img"
                    :src="getModelLogoSrc(row.model)"
                    :alt="getModelCompanyName(row.model)"
                  />
                  <span v-else>{{ getModelLogoText(row.model) }}</span>
                </span>
                <span class="model-share-name" :title="row.label">{{ row.label }}</span>
                <span v-if="tokenMiniMetric === 'both'" class="metric-pair model-share-token">
                  <span :style="{ color: TOKEN_METRIC_COLOR }">{{ row.tokenText }}</span>
                  <span :style="{ color: COST_METRIC_COLOR }">{{ row.costText }}</span>
                </span>
                <span v-else class="model-share-token" :style="{ color: tokenMiniCurrentMetricColor }">{{ row.metricText }}</span>
                <span class="model-share-pct">{{ row.pct }}%</span>
              </button>
            </div>
          </el-scrollbar>
          <button
            v-if="modelShareHiddenCount > 0 || modelShareExpanded"
            class="cockpit-disclosure"
            type="button"
            :aria-expanded="modelShareExpanded"
            @click.stop="setOverviewListsExpanded(!modelShareExpanded)"
          >
            {{
              modelShareExpanded
                ? `已展开 ${modelShareExpandedVisibleCount} / ${modelShareRows.length} 个模型 · 收起`
                : `展开其余 ${modelShareHiddenCount} 个模型`
            }}
          </button>
          <span v-else class="cockpit-disclosure-spacer" aria-hidden="true"></span>
        </article>

        <article class="cockpit-card agent-pulse-card" ref="agentPulseCardEl">
          <div class="cockpit-card-header">
            <div>
              <div class="cockpit-eyebrow">Agent 工作脉冲</div>
              <h2>{{ selectedPulseHeadline }}</h2>
            </div>
            <div class="agent-pulse-summary">
              <span>{{ selectedPulseCountText }}</span>
              <span>{{ selectedPulseMetricText }}</span>
            </div>
          </div>

          <div class="agent-pulse-app-tabs" aria-label="选择 APP">
            <button
              v-for="app in pulseApps"
              :key="app.id"
              class="agent-pulse-app-tab"
              :class="{ active: selectedPulseAppId === app.id }"
              type="button"
              @click="selectPulseApp(app.id)"
            >
              <span class="agent-pulse-app-icon" :class="`is-${app.id}`" aria-hidden="true">
                <img :src="app.iconSrc" :alt="app.name" />
              </span>
              <span class="agent-pulse-app-name">{{ app.name }}</span>
              <span class="agent-pulse-app-meta">{{ app.countText }}</span>
              <span class="agent-pulse-app-value" :style="{ color: tokenMiniCurrentMetricColor }">{{ app.metricText }}</span>
            </button>
          </div>

          <div v-if="showPulseStatusFilter" class="agent-pulse-filter-strip">
            <span>已筛选：{{ pulseStatusFilterLabel }}</span>
            <button type="button" @click="clearPulseStatusFilter()">查看全部</button>
          </div>

          <div
            v-if="selectedPulseRows.length > 0"
            class="agent-pulse-grid agent-pulse-grid--two-level"
            :class="{ 'is-scrollable': selectedPulseRows.length > 8 }"
          >
            <button
              v-for="row in selectedPulseRows"
              :key="row.key"
              class="agent-pulse-item"
              :class="[row.statusClass, { 'is-local-source': row.kind !== 'openclaw' }]"
              data-project-entry="pulse"
              :data-project-name="row.projectScope?.projectName"
              type="button"
              @click="onPulseRowClick(row)"
            >
              <span class="agent-pulse-avatar-wrap" aria-hidden="true">
                <img
                  v-if="row.avatarSrc"
                  class="agent-pulse-avatar"
                  :class="{ 'is-claude-code': row.kind === 'claude-code' }"
                  :src="row.avatarSrc"
                  :alt="row.name"
                  @error="setDefaultAvatar"
                />
                <span v-else class="agent-pulse-avatar agent-pulse-avatar-placeholder">{{ row.avatarText }}</span>
                <span class="agent-pulse-dot"></span>
              </span>
              <span class="agent-pulse-title">
                <span class="agent-pulse-name" :title="row.project || row.name">{{ row.name }}</span>
              </span>
              <span class="agent-pulse-status">{{ row.statusLabel }}</span>
              <span v-if="tokenMiniMetric === 'both'" class="metric-pair agent-pulse-token">
                <span :style="{ color: TOKEN_METRIC_COLOR }">{{ row.tokenText }}</span>
                <span :style="{ color: COST_METRIC_COLOR }">{{ row.costText }}</span>
              </span>
              <span v-else class="agent-pulse-token" :style="{ color: tokenMiniCurrentMetricColor }">{{ row.metricText }}</span>
            </button>
          </div>
          <div v-else class="agent-pulse-empty">
            {{ selectedPulseEmptyText }}
          </div>
        </article>

        <article class="cockpit-card contribution-card">
          <div class="cockpit-card-header">
            <div>
              <div class="cockpit-eyebrow">{{ contributionEyebrow }}</div>
              <h2>{{ contributionTitle }}</h2>
            </div>
            <button class="cockpit-link-btn" @click="openTokenDetail()">看明细</button>
          </div>
          <el-scrollbar
            v-if="contributionRows.length > 0"
            class="contribution-scroll"
            :class="{
              'is-expanded': contributionExpanded,
            }"
            :always="contributionExpanded"
          >
            <div class="contribution-list">
              <div
                v-for="(row, index) in visibleContributionRows"
                :key="row.key"
                class="contribution-row"
                :class="{ 'is-local-source': row.kind !== 'openclaw' }"
                data-project-entry="contribution"
                :data-project-name="row.projectScope?.projectName"
                @click="onContributionRowClick(row)"
              >
                <div class="contribution-person" :title="`第 ${index + 1} 名`">
                  <img
                    class="contribution-avatar"
                    :class="{ 'is-claude-code': row.kind === 'claude-code' }"
                    :src="row.avatarSrc"
                    :alt="row.name"
                    @error="setDefaultAvatar"
                  />
                </div>
                <div class="contribution-body">
                  <div class="contribution-line">
                    <div class="contribution-title-wrap">
                      <span class="contribution-name" :title="row.project || row.name">{{ row.name }}</span>
                    </div>
                    <strong v-if="tokenMiniMetric === 'both'" class="metric-pair contribution-value">
                      <span :style="{ color: TOKEN_METRIC_COLOR }">{{ row.tokenText }}</span>
                      <span :style="{ color: COST_METRIC_COLOR }">{{ row.costText }}</span>
                    </strong>
                    <strong v-else class="contribution-value" :style="{ color: tokenMiniCurrentMetricColor }">{{ row.metricText }}</strong>
                  </div>
                  <template v-if="tokenMiniMetric === 'both'">
                    <div class="contribution-bar">
                      <span :style="{ width: barW(row.usage.tokens, contributionMaxTokens), backgroundColor: TOKEN_METRIC_COLOR }"></span>
                    </div>
                    <div class="contribution-bar contribution-bar--cost">
                      <span :style="{ width: barW(row.usage.cost, contributionMaxCost), backgroundColor: COST_METRIC_COLOR }"></span>
                    </div>
                  </template>
                  <div v-else class="contribution-bar">
                    <span :style="{ width: contributionWidth(row.usageValue), backgroundColor: contributionBarColor }"></span>
                  </div>
                </div>
              </div>
            </div>
          </el-scrollbar>
          <button
            v-if="contributionHiddenCount > 0 || contributionExpanded"
            class="cockpit-disclosure"
            type="button"
            :aria-expanded="contributionExpanded"
            @click="setOverviewListsExpanded(!contributionExpanded)"
          >
            {{
              contributionExpanded
                ? `已展开 ${contributionExpandedVisibleCount} / ${contributionRows.length} 项 · 收起`
                : `展开其余 ${contributionHiddenCount} 项`
            }}
          </button>
          <div v-if="contributionRows.length === 0" class="contribution-empty">{{ contributionEmptyText }}</div>
        </article>
      </div>
    </section>

    <!-- ========= 2. 操作区：运行摘要 + 功能入口 ========= -->
    <section class="control-dock-section" :style="{ order: pageModuleOrder('controlDock') }">
      <div class="control-dock-inner">
        <div class="ops-summary-list" aria-label="运行摘要">
          <button
            v-for="stat in statsCards"
            :key="stat.id"
            class="stat-pill"
            :class="[stat.class, { 'stat-clickable': !!stat.onClick }]"
            type="button"
            :title="stat.title"
            @click="stat.onClick?.()"
          >
            <span class="stat-icon-wrap" :class="stat.iconClass">
              <el-icon :size="19"><component :is="stat.icon" /></el-icon>
            </span>
            <span class="stat-text">
              <span class="stat-number">{{ stat.value }}</span>
              <span class="stat-label">
                {{ stat.label }}
              </span>
            </span>
          </button>
        </div>

        <div class="action-bar-inner">
        <!-- GPU VRAM Usage -->
        <div
          class="action-slot action-slot--secondary"
          v-if="store.gpuVramPercentage !== null && store.gpuVramPercentage !== undefined"
          :style="{ order: statusBarOrder('gpu') }"
        >
          <el-tooltip :content="`${store.gpuVramUsedMb} / ${store.gpuVramTotalMb} MB`" placement="top">
            <button class="action-btn action-gpu">
              <el-icon :size="22"><Monitor /></el-icon>
              <div class="action-text">
                <div class="action-label">GPU 显存</div>
                <div class="action-value">{{ store.gpuVramPercentage }}%</div>
              </div>
            </button>
          </el-tooltip>
        </div>

        <!-- 文件管理 -->
        <div class="action-slot action-slot--primary" :style="{ order: statusBarOrder('fileManager') }">
          <button class="action-btn" @click="fileManagerVisible = true">
            <el-icon :size="22"><Folder /></el-icon>
            <div class="action-text">
              <div class="action-label">文件管理</div>
              <div class="action-value">管理工作目录</div>
            </div>
          </button>
        </div>

        <!-- 计费配置 -->
        <div class="action-slot action-slot--primary" :style="{ order: statusBarOrder('billing') }">
          <button class="action-btn" @click="billingDialogVisible = true">
            <el-icon :size="22"><Money /></el-icon>
            <div class="action-text">
              <div class="action-label">计费配置</div>
              <div class="action-value">按模型定价</div>
            </div>
          </button>
        </div>

        <!-- 技能库 -->
        <div class="action-slot action-slot--primary action-slot--primary-last" :style="{ order: statusBarOrder('skills') }">
          <button class="action-btn" @click="openToolManagement('skills')">
            <el-icon :size="22"><Briefcase /></el-icon>
            <div class="action-text">
              <div class="action-label">AI 工具能力</div>
              <div class="action-value">按能力管理</div>
            </div>
          </button>
        </div>

        <!-- 原生控制台 -->
        <div class="action-slot action-slot--secondary action-slot--secondary-wide" :style="{ order: statusBarOrder('webui') }">
          <button class="action-btn" @click="openToolManagement('nativeUi')">
            <el-icon :size="22"><Link /></el-icon>
            <div class="action-text">
              <div class="action-label">原生控制台</div>
              <div class="action-value">按工具打开</div>
            </div>
          </button>
        </div>

        <!-- 项目与任务 -->
        <div class="action-slot action-slot--secondary" :style="{ order: statusBarOrder('projects') }">
          <button class="action-btn" @click="openToolManagement('tasks')">
            <el-icon :size="22"><Grid /></el-icon>
            <div class="action-text">
              <div class="action-label">项目与任务</div>
              <div class="action-value">{{ projectSummary }}</div>
            </div>
          </button>
        </div>

        <!-- 自动任务 -->
        <div class="action-slot action-slot--secondary" :style="{ order: statusBarOrder('cron') }">
          <button class="action-btn" @click="openToolManagement('automation')">
            <el-icon :size="22"><Timer /></el-icon>
            <div class="action-text">
              <div class="action-label">自动任务</div>
              <div class="action-value">按工具管理</div>
            </div>
          </button>
        </div>
      </div>
      </div>
    </section>

    <!-- ========= 3. 工作流进度步进条 / 空状态 ========= -->
    <div class="workflow-section" v-if="workflowData.projectName" :style="{ order: pageModuleOrder('workflow') }">
      <el-card shadow="hover" class="workflow-card">
        <div class="workflow-card-header">
          <span class="workflow-project-name">{{ workflowData.projectName }}</span>
          <div class="workflow-header-right" v-if="workflowData.activeStep >= 0">
            <span v-if="workflowData.taskSummary" class="workflow-task-summary-inline">
              {{ workflowData.taskSummary }}
            </span>
            <el-tag v-if="workflowData.mode" size="small" :type="getModeTagType(workflowData.mode)" effect="plain" class="workflow-mode-tag">
              {{ workflowData.mode }}
            </el-tag>
          </div>
          <div v-if="workflowData.steps.length > 0 && workflowData.activeStep >= 0">
            <span class="workflow-step-label">
              第 {{ workflowData.activeStep + 1 }} / {{ workflowData.steps.length }} 步
            </span>
          </div>
        </div>

        <div v-if="workflowData.activeStep >= 0 && workflowData.steps.length > 0" class="workflow-steps-simple">
          <template v-for="(step, idx) in workflowData.steps" :key="idx">
            <div class="workflow-step-simple-item" :class="{ 'is-active': idx === workflowData.activeStep }">
              <span class="simple-step-circle" :class="getSimpleStepClass(idx)"></span>
              <span class="simple-step-title">{{ step.title }}</span>
            </div>
            <div
              v-if="idx < workflowData.steps.length - 1"
              class="step-arrow-group"
              :class="getArrowState(idx)"
            >
              <el-icon class="step-arrow-chevron" :style="{ animationDelay: '0ms' }"><ArrowRight /></el-icon>
              <el-icon class="step-arrow-chevron" :style="{ animationDelay: '200ms' }"><ArrowRight /></el-icon>
              <el-icon class="step-arrow-chevron" :style="{ animationDelay: '400ms' }"><ArrowRight /></el-icon>
            </div>
          </template>
        </div>

        <div v-else class="workflow-empty-state">
          <el-icon :size="28" class="workflow-empty-icon"><VideoPause /></el-icon>
          <span class="workflow-empty-text">当前无任务执行</span>
        </div>
      </el-card>
    </div>

    <!-- ========= 3.5 内联活动时间线（Inline Activity Timeline，可折叠）=========
         layoutConfig.sections.timeline 控制是否显示（可在自定义布局关闭）
    -->
    <section
      v-if="layoutConfig.sections?.timeline !== false"
      class="inline-timeline-section module-card-section"
      :class="{ collapsed: layoutConfig.timelineCollapsed }"
      :style="{ order: pageModuleOrder('timeline') }"
    >
      <div class="module-card-shell">
        <button class="module-card-toggle" type="button" @click="toggleTimelineCollapsed()">
          <span class="module-card-title">
            <span class="module-card-eyebrow">运行记录</span>
            <strong>AI 工具活动时间线</strong>
          </span>
          <span class="module-card-hints">
            <span>全部工具</span>
            <span>按会话展开</span>
          </span>
          <el-icon class="module-card-arrow" :class="{ expanded: !layoutConfig.timelineCollapsed }"><ArrowRight /></el-icon>
        </button>

        <!-- 折叠内容（收起时 v-show 控制隐藏但保留 DOM）-->
        <div v-show="!layoutConfig.timelineCollapsed" class="module-card-content itl-content">
          <UnifiedActivityTimeline :inline="true" @execution="openExecutionScope" />
        </div>
      </div>
    </section>

    <!-- ========= 3.6 内联版本迭代说明（Inline Changelog Panel，可折叠）=========
         layoutConfig.sections.changelog 控制是否显示（可在自定义布局关闭）
    -->
    <section
      v-if="layoutConfig.sections?.changelog !== false"
      class="inline-changelog-section module-card-section"
      :class="{ collapsed: layoutConfig.changelogCollapsed }"
      :style="{ order: pageModuleOrder('changelog') }"
    >
      <div class="module-card-shell">
        <button class="module-card-toggle" type="button" @click="toggleChangelogCollapsed()">
          <span class="module-card-title">
            <span class="module-card-eyebrow">版本体系</span>
            <strong>版本迭代说明</strong>
          </span>
          <span class="module-card-hints">
            <span>Changelog</span>
            <span>版本回退</span>
            <span class="module-card-badge">v{{ APP_VERSION }}</span>
          </span>
          <el-icon class="module-card-arrow" :class="{ expanded: !layoutConfig.changelogCollapsed }"><ArrowRight /></el-icon>
        </button>

        <!-- 折叠内容 -->
        <div v-show="!layoutConfig.changelogCollapsed" class="module-card-content icl-content">
          <ChangelogPanel />
        </div>
      </div>
    </section>

    <!-- ========= 4. AI 工具任务看板（默认收起） ========= -->
    <section class="task-board-section" :style="{ order: pageModuleOrder('taskBoard') }">
      <div class="task-board-shell" :class="{ expanded: taskBoardExpanded }">
        <button class="task-board-toggle" type="button" @click="taskBoardExpanded = !taskBoardExpanded">
          <span class="task-board-title">
            <span class="task-board-eyebrow">任务看板</span>
            <strong>{{ taskBoardExpanded ? '收起 AI 工具任务区' : '展开 AI 工具任务区' }}</strong>
          </span>
          <span class="task-board-summary">
            <span>总计 {{ monitorTotalObjectCount }}</span>
            <span>运行 {{ monitorStatusCount('running') }}</span>
            <span>空闲 {{ monitorStatusCount('idle') }}</span>
            <span>已终止 {{ monitorStatusCount('aborted') }}</span>
            <span>错误 {{ monitorStatusCount('error') }}</span>
          </span>
          <el-icon class="task-board-arrow" :class="{ expanded: taskBoardExpanded }"><ArrowRight /></el-icon>
        </button>

        <main v-show="taskBoardExpanded" class="board-container">
          <div
            v-for="column in monitorBoardColumns"
            :key="column.status"
            class="board-column"
            :class="`board-column-${column.status}`"
          >
            <div class="board-column-header" :style="{ borderBottomColor: column.color }">
              <span class="board-column-label" :style="{ color: column.color }">
                <span class="board-status-dot" :style="{ backgroundColor: column.color }" />
                {{ column.label }}
              </span>
              <el-tag
                size="small"
                :style="{
                  background: `${column.color}24`,
                  color: column.color,
                  borderColor: column.color,
                }"
              >
                {{ monitorBoardRows(column.status).length }} 个
              </el-tag>
            </div>
            <div
              class="board-column-tasks"
              v-loading="(store.isPolling || localAiUsageLoading) && monitorAllRows.length === 0"
            >
              <MonitorObjectCard
                v-for="row in monitorBoardRows(column.status)"
                :key="row.monitorKey"
                :name="row.name"
                :source-name="row.sourceName"
                :source-icon-src="row.sourceIconSrc"
                :avatar-src="row.avatarSrc"
                :status="row.monitorStatus"
                :status-label="row.statusLabel"
                :last-activity-text="row.lastActivityText"
                :project="row.project"
                :token-text="row.tokenText"
                :cost-text="row.costText"
                @view="openMonitorObject(row)"
              />
              <el-empty
                v-if="monitorBoardRows(column.status).length === 0 && !store.isPolling && !localAiUsageLoading"
                :description="column.emptyText"
                :image-size="50"
              />
            </div>
          </div>
        </main>
      </div>
    </section>

    <!-- Agent Detail Drawer -->
    <AgentDetailDrawer
      v-model:visible="drawerVisible"
      :agent-data="selectedAgent"
      :auto-focus-input="drawerAutoFocusInput"
      @view-execution="openAgentExecution"
      @closed="onAgentDetailClosed"
    />

    <!-- Token 消耗详情弹窗 -->
    <TokenDetailDialog
      v-model:visible="tokenDetailVisible"
      :source-filter="tokenDetailSourceFilter"
      :project-scope="tokenDetailProjectScope"
      @view-execution="openProjectExecution"
    />

    <SessionExecutionDialog
      v-model:visible="sessionExecutionVisible"
      :scope="sessionExecutionScope"
    />

    <MonitorObjectDetailDialog
      v-model:visible="monitorObjectDetailVisible"
      :object="selectedMonitorDetailObject"
      @execution="openSelectedMonitorExecution"
      @usage="openSelectedMonitorUsage"
      @specialized="openSelectedMonitorSpecialized"
    />

    <!-- Version Dialog (REC-068) -->
    <VersionDialog
      v-model:visible="versionDialogVisible"
      :current-version="store.gatewayVersion || ''"
      :latest-version="openClawLatestVersion"
      :update-available="openClawUpdateAvailable"
      @refresh-update-status="checkOpenClawUpdate"
      @version-changed="handleOpenClawVersionChanged"
    />

    <!-- Skills Dialog (REC-005) -->
    <SkillsDialog v-model:visible="skillsDialogVisible" />

    <!-- 计费配置 Dialog -->
    <BillingConfigDialog v-model:visible="billingDialogVisible" @saved="handleBillingSaved" />

    <!-- 底部 Token / 费用摘要的独立时间范围 -->
    <el-dialog
      v-model="summaryUsageDialogVisible"
      class="summary-usage-range-dialog"
      width="480px"
      append-to-body
      destroy-on-close
    >
      <template #header>
        <div class="summary-range-dialog-head">
          <h2>摘要显示范围</h2>
          <p>只影响底部 Token 和费用两张卡片，不跟随页面上方时间范围。</p>
        </div>
      </template>
      <div class="summary-range-options" aria-label="摘要显示范围">
        <button
          v-for="option in SUMMARY_USAGE_RANGES"
          :key="option.value"
          class="token-mini-chip summary-range-option"
          :class="{ active: summaryUsageRange === option.value }"
          type="button"
          @click="setSummaryUsageRange(option.value)"
        >{{ option.label }}</button>
      </div>
    </el-dialog>

    <!-- 自定义布局 Dialog -->
    <LayoutSettingsDialog v-model:visible="layoutDialogVisible" />

    <!-- 项目看板 Dialog -->
    <ProjectBoardDialog v-model:visible="projectBoardVisible" />

    <!-- Cron 任务中心 Dialog -->
    <CronCenterDialog v-model:visible="cronCenterVisible" />

    <!-- 监控对象明细 Dialog -->
    <el-dialog
      v-model="monitorObjectsDialogVisible"
      class="monitor-objects-dialog"
      width="920px"
      append-to-body
      destroy-on-close
    >
      <template #header>
        <div class="monitor-detail-head">
          <div>
            <div class="monitor-detail-eyebrow">全平台对象</div>
            <h2>监控对象明细</h2>
          </div>
          <div class="monitor-detail-head-meta">
            <strong>{{ monitorVisibleRowCount }}</strong>
            <span>{{ monitorShowHidden ? '已隐藏' : '当前显示' }}</span>
          </div>
        </div>
      </template>

      <div class="monitor-detail-panel">
        <div class="monitor-detail-tabs" role="tablist" aria-label="监控对象状态">
          <button
            v-for="tab in monitorStatusTabs"
            :key="tab.value"
            type="button"
            class="monitor-detail-tab"
            :class="{ active: monitorDetailStatus === tab.value }"
            @click="monitorDetailStatus = tab.value"
          >
            <span>{{ tab.label }}</span>
            <strong>{{ monitorStatusCount(tab.value) }}</strong>
          </button>
        </div>

        <div class="monitor-detail-toolbar">
          <div class="monitor-source-filter">
            <span class="monitor-toolbar-label">来源</span>
            <button
              v-for="source in monitorSourceOptions"
              :key="source.id"
              type="button"
              class="monitor-source-chip"
              :class="{ active: monitorSourceFilter.includes(source.id) }"
              @click="toggleMonitorSource(source.id)"
            >
              <img :src="source.iconSrc" :alt="source.name" />
              <span>{{ source.name }}</span>
              <strong>{{ source.countText }}</strong>
            </button>
          </div>

          <div class="monitor-detail-actions">
            <button type="button" class="monitor-action-btn" @click="showAllMonitorSources()">全部来源</button>
            <button
              type="button"
              class="monitor-action-btn"
              :class="{ active: monitorShowHidden }"
              @click="monitorShowHidden = !monitorShowHidden"
            >
              已隐藏 {{ monitorHiddenKeys.length }}
            </button>
            <button
              type="button"
              class="monitor-action-btn danger"
              :disabled="monitorHiddenKeys.length === 0"
              @click="resetMonitorHiddenObjects()"
            >
              全部恢复
            </button>
          </div>
        </div>

        <div class="monitor-source-summary">
          <div v-for="source in monitorSourceOptions" :key="source.id" class="monitor-source-card">
            <span>{{ source.name }}</span>
            <strong>{{ source.countText }}</strong>
            <em>{{ source.metricText }}</em>
          </div>
        </div>

        <div v-if="monitorDetailRows.length > 0" class="monitor-object-list">
          <div
            v-for="row in monitorDetailRows"
            :key="row.monitorKey"
            class="monitor-object-row"
            :class="{ hidden: row.hidden }"
            data-project-entry="monitor"
            :data-project-name="row.projectScope?.projectName"
          >
            <span class="monitor-object-avatar-wrap" aria-hidden="true">
              <img
                v-if="row.avatarSrc"
                class="monitor-object-avatar"
                :class="{ 'is-claude-code': row.kind === 'claude-code' }"
                :src="row.avatarSrc"
                :alt="row.name"
                @error="setDefaultAvatar"
              />
              <span v-else class="monitor-object-avatar monitor-object-avatar-placeholder">{{ row.avatarText }}</span>
            </span>
            <div class="monitor-object-main">
              <div class="monitor-object-title">
                <strong :title="row.project || row.name">{{ row.name }}</strong>
                <span class="monitor-source-name">{{ row.sourceName }}</span>
              </div>
              <div class="monitor-object-sub">
                <span class="monitor-status-badge" :class="row.statusClass">{{ row.statusLabel }}</span>
                <span>{{ row.lastActivityText }}</span>
              </div>
            </div>
            <div class="monitor-object-metrics">
              <span :style="{ color: TOKEN_METRIC_COLOR }">{{ row.tokenText }}</span>
              <span :style="{ color: COST_METRIC_COLOR }">{{ row.costText }}</span>
            </div>
            <div class="monitor-object-actions">
              <button type="button" @click="openMonitorObject(row)">查看</button>
              <button v-if="row.hidden" type="button" @click="restoreMonitorObject(row.monitorKey)">恢复</button>
              <button v-else type="button" @click="hideMonitorObject(row.monitorKey)">隐藏</button>
            </div>
          </div>
        </div>

        <div v-else class="monitor-object-empty">
          {{ monitorShowHidden ? '没有符合条件的隐藏对象' : '没有符合条件的监控对象' }}
        </div>
      </div>
    </el-dialog>

    <!-- Sprint 7: 命令面板 + 活动时间线 -->
    <CommandPaletteDialog
      v-model="commandPaletteVisible"
      :monitor-objects="monitorAllRows"
      @open-action="handlePaletteAction"
      @navigate-agent="handlePaletteNavigateAgent"
      @open-token-source="openTokenDetail"
      @open-monitor-object="openMonitorObjectByKey"
    />
    <UnifiedActivityTimeline
      v-model="activityTimelineVisible"
      @execution="openExecutionScope"
    />

    <ToolManagementDialog
      v-model="toolManagementVisible"
      :tools="aiToolDescriptors"
      :focus-action="toolManagementFocus"
      @action="handleToolManagementAction"
    />

    <FileManagerDialog v-model="fileManagerVisible" />

    <NotificationDetailDialog
      v-model="notificationDetailVisible"
      :notification="selectedNotification"
      :retrying="notificationRetrying"
      @retry="retryNotification"
    />


    <!-- Sprint 9: #6 快捷消息发送 FAB（Floating Action Button 浮动操作按钮）-->
    <QuickMsgFab />

    <!-- REC-011: 加载超时提示 -->
    <el-alert
      v-if="loadingHintVisible"
      title="正在加载，请稍候..."
      type="info"
      :closable="false"
      show-icon
      class="loading-hint-alert"
      plain
    >
      <template #default>
        <span>数据加载中（已超过 10 秒），请耐心等待...</span>
      </template>
    </el-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useAgentStore, type AgentInfo } from '../stores/agent'
import MonitorObjectCard from '../components/MonitorObjectCard.vue'
import MonitorObjectDetailDialog from '../components/MonitorObjectDetailDialog.vue'
import AgentDetailDrawer from '../components/AgentDetailDrawer.vue'
import TokenDetailDialog from '../components/TokenDetailDialog.vue'
import SessionExecutionDialog from '../components/SessionExecutionDialog.vue'
import VersionDialog from '../components/VersionDialog.vue'
import SkillsDialog from '../components/SkillsDialog.vue'
import BillingConfigDialog from '../components/BillingConfigDialog.vue'
import LayoutSettingsDialog from '../components/LayoutSettingsDialog.vue'
import ProjectBoardDialog from '../components/ProjectBoardDialog.vue'
import CronCenterDialog from '../components/CronCenterDialog.vue'
import CommandPaletteDialog from '../components/CommandPaletteDialog.vue'
import UnifiedActivityTimeline from '../components/UnifiedActivityTimeline.vue'
import ToolManagementDialog from '../components/ToolManagementDialog.vue'
import FileManagerDialog from '../components/FileManagerDialog.vue'
import NotificationDetailDialog from '../components/NotificationDetailDialog.vue'
import ChangelogPanel from '../components/ChangelogPanel.vue'
import QuickMsgFab from '../components/QuickMsgFab.vue'
import { useLayoutSettings } from '../composables/useLayoutSettings'
import { useTheme } from '../composables/useTheme'
import { type WorkflowData } from '../data/workflow-steps'
import { formatTokenZh } from '../utils/tokenFormat'
import {
  localUsageSourceId,
  mergeUsageTimelines,
} from '../utils/usageTimeline'
import { setDefaultAvatar } from '../utils/avatarFallback'
import { normalizeAgentAvatarSource } from '../utils/agent-presentation.mjs'
import { createSafeRecord, ownValue, safeRecordFrom } from '../utils/safe-record.mjs'
import { createProjectTokenScope, normalizeProjectPath, projectFolderName } from '../utils/project-token-scope.mjs'
import { createUsageStatisticsManager } from '../utils/usage-statistics-manager.mjs'
import {
  createAiToolRegistry,
  DEFAULT_AI_TOOLS,
  type AiToolDescriptor,
} from '../utils/ai-tool-registry.mjs'
import type { AiToolManagementActionId } from '../utils/ai-tool-actions.mjs'
import type { ProjectTokenScope } from '../types/project-token-scope'
import type { SessionObservationScope } from '../types/session-observation'
import type { NotificationItem } from '../utils/notification-center.mjs'
import { getOpenClawUpdateStatus, type OpenClawUpdateStatus } from '../api/version-manager'
import {
  Monitor,
  CircleCheck,
  Warning,
  Odometer,
  VideoPlay,
  VideoPause,
  CircleClose,
  Money,
  ArrowRight,
  Briefcase,
  Folder,
  Bell,
  BellFilled,
  Operation,
  Box,
  Link,
  Grid,
  Timer,
  Search,
  Sunny,
  Moon,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

// App version from package.json (injected by Vite define)
const APP_VERSION: string = __APP_VERSION__
// 版本号主体（去掉 -beta 后缀，横排显示）+ 是否内测版（单独标签展示）
const displayVersion = computed(() => APP_VERSION.replace(/-beta.*$/i, ''))
const isBeta = computed(() => /beta/i.test(APP_VERSION))


const store = useAgentStore()
const usageStatisticsManager = createUsageStatisticsManager({
  notify: (notification, options) => store.addNotificationOnce(notification, options),
})

// Real-time clock in status bar (updates every minute)
const currentTime = ref('')
let clockTimer: ReturnType<typeof setInterval> | null = null

function updateClock(): void {
  const now = new Date()
  const Y = now.getFullYear()
  const M = String(now.getMonth() + 1).padStart(2, '0')
  const D = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  currentTime.value = `${Y}年${M}月${D}日 ${h}:${m}`
}

// Workflow steps data (REC-031: 从 workflow-progress.json 轮询)
const WORKFLOW_POLL_INTERVAL = 10000
const BACKGROUND_WORKFLOW_POLL_INTERVAL = 60000
const workflowData = ref<WorkflowData>({ activeStep: -1, steps: [] })
let workflowTimer: ReturnType<typeof setTimeout> | null = null

async function fetchWorkflowData(): Promise<void> {
  try {
    const res = await fetch('/workflow-progress.json?t=' + Date.now())
    if (res.ok) {
      const data: WorkflowData = await res.json()
      workflowData.value = data
    }
  } catch {
    // 保持当前值
  }
}

function scheduleWorkflowPoll(): void {
  if (workflowTimer) clearTimeout(workflowTimer)
  workflowTimer = setTimeout(async () => {
    await fetchWorkflowData()
    scheduleWorkflowPoll()
  }, document.hidden ? BACKGROUND_WORKFLOW_POLL_INTERVAL : WORKFLOW_POLL_INTERVAL)
}

function handleWorkflowVisibilityChange(): void {
  if (document.hidden) {
    scheduleWorkflowPoll()
    return
  }
  fetchWorkflowData()
  scheduleWorkflowPoll()
}

/** 运行模式标签颜色映射 */
function getModeTagType(mode: string): string {
  const map: Record<string, string> = {
    '极速': 'danger',
    '简化': 'warning',
    '正常': 'primary',
    '最优': 'success',
  }
  return map[mode] || 'info'
}

/** 根据步骤索引返回圆点状态 class (Element Plus Simple 风格) */
function getSimpleStepClass(idx: number): string {
  const active = workflowData.value.activeStep
  if (idx < active) return 'simple-step-finished'
  if (idx === active) return 'simple-step-process'
  return 'simple-step-waiting'
}

/** 根据步骤索引返回箭头组的状态 class */
function getArrowState(idx: number): string {
  const active = workflowData.value.activeStep
  if (idx < active) return 'arrow-finished'   // 已完成节点后的箭头
  if (idx === active) return 'arrow-process'  // 正在执行节点后的箭头
  return 'arrow-waiting'                      // 未完成节点后的箭头
}

// Drawer
const drawerVisible = ref(false)
const selectedAgent = ref<AgentInfo | null>(null)

// Token 详情弹窗
const tokenDetailVisible = ref(false)
const tokenDetailSourceFilter = ref<string | null>(null)
const tokenDetailProjectScope = ref<ProjectTokenScope | null>(null)

function openTokenDetail(sourceId: string | null = null, projectScope: ProjectTokenScope | null = null): void {
  tokenDetailSourceFilter.value = sourceId
  tokenDetailProjectScope.value = projectScope
  tokenDetailVisible.value = true
}

const sessionExecutionVisible = ref(false)
const sessionExecutionScope = ref<SessionObservationScope | null>(null)
const pendingAgentExecutionScope = ref<SessionObservationScope | null>(null)
const monitorObjectDetailVisible = ref(false)
const selectedMonitorObject = ref<MonitorObjectRow | null>(null)

function openExecutionScope(scope: SessionObservationScope): void {
  sessionExecutionScope.value = scope
  sessionExecutionVisible.value = true
}

function openProjectExecution(scope: ProjectTokenScope): void {
  pendingAgentExecutionScope.value = null
  const sessionIds = scope.sources
    .map(source => source.sessionId)
    .filter((sessionId): sessionId is string => Boolean(sessionId))
  if (!sessionIds.length) {
    ElMessage.warning('当前项目没有可识别的会话 ID')
    return
  }
  openExecutionScope({
    source: scope.appId,
    displayName: `${scope.appName} · ${scope.projectName}`,
    sessionIds,
  })
}

function openAgentExecution(agent: AgentInfo): void {
  if (pendingAgentExecutionScope.value) return
  const agentId = String(agent.key || '').split(':')[1] || String(agent.name || '')
  if (!agentId) {
    ElMessage.warning('当前 Agent 没有可识别的 ID')
    return
  }
  pendingAgentExecutionScope.value = {
    source: 'openclaw',
    displayName: agent.displayName || agent.name || agentId,
    agentId,
    sessionIds: [],
  }
  drawerVisible.value = false
}

function onAgentDetailClosed(): void {
  const pendingScope = pendingAgentExecutionScope.value
  if (!pendingScope) return
  pendingAgentExecutionScope.value = null
  sessionExecutionScope.value = pendingScope
  sessionExecutionVisible.value = true
}

watch(sessionExecutionVisible, (isVisible) => {
  if (!isVisible) sessionExecutionScope.value = null
})

watch(tokenDetailVisible, (isVisible) => {
  if (isVisible) return
  tokenDetailSourceFilter.value = null
  tokenDetailProjectScope.value = null
})

// Version dialog
const versionDialogVisible = ref(false)
const openClawUpdateStatus = ref<OpenClawUpdateStatus | null>(null)
const openClawLatestVersion = computed(() => openClawUpdateStatus.value?.latestVersion || '')
const openClawUpdateAvailable = computed(() => openClawUpdateStatus.value?.updateAvailable === true)
const openClawVersionDisplay = computed(() => {
  const current = store.gatewayVersion || openClawUpdateStatus.value?.currentVersion || '未知'
  return openClawUpdateAvailable.value ? `${current} → ${openClawLatestVersion.value}` : current
})
const openClawUpdateTooltip = computed(() => openClawUpdateAvailable.value
  ? `可更新至 ${openClawLatestVersion.value}，点击查看并更新`
  : '点击查看 OpenClaw 版本')
const OPENCLAW_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
let openClawUpdateTimer: ReturnType<typeof setInterval> | null = null

function hasNotificationCode(code: string): boolean {
  return store.notifications.some(item => item.errorCode === code)
}

async function checkOpenClawUpdate(): Promise<void> {
  try {
    const status = await getOpenClawUpdateStatus()
    openClawUpdateStatus.value = status
    if (status.updateAvailable && status.latestVersion) {
      const code = `openclaw_update_available_${status.latestVersion.replace(/[^0-9A-Za-z]+/g, '_')}`
      if (!hasNotificationCode(code)) {
        store.addNotification({
          type: 'info',
          agentId: 'openclaw-update',
          agentName: 'OpenClaw 更新',
          message: `发现新版本 ${status.latestVersion}`,
          source: 'OpenClaw 版本检查',
          detail: `当前版本 ${status.currentVersion || store.gatewayVersion || '未知'}，可更新至 ${status.latestVersion}。`,
          errorCode: code,
          impact: '当前版本可继续使用，不会自动更新。',
          currentResult: '点击顶部“OpenClaw 可更新”即可查看并手动更新。',
        })
      }
    } else if (status.error && !hasNotificationCode('openclaw_update_check_failed')) {
      store.addNotification({
        type: 'error',
        agentId: 'openclaw-update',
        agentName: 'OpenClaw 更新',
        message: 'OpenClaw 更新检查失败',
        source: 'OpenClaw 版本检查',
        detail: status.error,
        errorCode: 'openclaw_update_check_failed',
        impact: '暂时无法判断是否存在新版本。',
        currentResult: '当前 OpenClaw 和工作台可继续使用。',
      })
    }
  } catch {
    if (!hasNotificationCode('openclaw_update_check_failed')) {
      store.addNotification({
        type: 'error',
        agentId: 'openclaw-update',
        agentName: 'OpenClaw 更新',
        message: 'OpenClaw 更新检查失败',
        source: 'OpenClaw 版本检查',
        detail: '工作台未能完成版本检查请求。',
        errorCode: 'openclaw_update_check_failed',
        impact: '暂时无法判断是否存在新版本。',
        currentResult: '当前 OpenClaw 和工作台可继续使用。',
      })
    }
  }
}

function handleOpenClawVersionChanged(): void {
  window.setTimeout(async () => {
    await store.fetchHealth()
    await checkOpenClawUpdate()
  }, 3000)
}

// Skills dialog (REC-005)
const skillsDialogVisible = ref(false)

// 计费配置 dialog
const billingDialogVisible = ref(false)
const summaryUsageDialogVisible = ref(false)

function showSealedFeature(feature: string): void {
  ElMessage.info(`${feature}暂时停用`)
}

// 自定义布局
const { config: layoutConfig, toggleTimelineCollapsed, toggleChangelogCollapsed } = useLayoutSettings()
const layoutDialogVisible = ref(false)

// 项目看板
const projectBoardVisible = ref(false)
const projectSummary = ref('按工具查看')

// Cron 任务中心
const cronCenterVisible = ref(false)

// Sprint 7: 命令面板 + 活动时间线弹窗备用（命令面板打开）
const commandPaletteVisible = ref(false)
const activityTimelineVisible = ref(false)
const toolManagementVisible = ref(false)
const toolManagementFocus = ref<AiToolManagementActionId | null>(null)
const fileManagerVisible = ref(false)
const notificationPopoverVisible = ref(false)
const notificationDetailVisible = ref(false)
const selectedNotification = ref<NotificationItem | null>(null)
const notificationRetrying = ref(false)

async function openNotificationDetail(notification: NotificationItem): Promise<void> {
  store.markNotificationRead(notification.id)
  selectedNotification.value = store.notifications.find(item => item.id === notification.id) || notification
  notificationPopoverVisible.value = false
  await nextTick()
  notificationDetailVisible.value = true
}

async function retryNotification(notification: NotificationItem): Promise<void> {
  if (!notification.retryAction || notificationRetrying.value) return
  notificationRetrying.value = true
  try {
    let succeeded = false
    if (notification.retryAction === 'refresh-token-usage') {
      succeeded = await refreshTokenUsageSnapshot({ blocking: true, force: true })
    } else if (notification.retryAction === 'prewarm-token-usage') {
      succeeded = await prewarmTokenUsageRanges()
    }
    if (succeeded) {
      ElMessage.success('重新加载成功')
      notificationDetailVisible.value = false
    } else {
      ElMessage.error('重新加载失败，错误详情已记录到通知中心')
    }
  } finally {
    notificationRetrying.value = false
  }
}

watch(notificationDetailVisible, (isVisible) => {
  if (!isVisible) selectedNotification.value = null
})

// Agent 任务看板默认下沉，避免首屏拥挤
const taskBoardExpanded = ref(false)

// Sprint 9: #18 主题切换（Dark/Light Theme Toggle）
const { isDark, toggleTheme } = useTheme()


function statusBarOrder(id: string): number {
  const idx = layoutConfig.value.statusBar.indexOf(id)
  return idx === -1 ? 100 : idx
}

function topBarControlOrder(id: string): number {
  const idx = layoutConfig.value.topBarControls.indexOf(id)
  return idx === -1 ? 100 : idx
}

function pageModuleOrder(id: string): number {
  const idx = layoutConfig.value.pageModules.indexOf(id)
  return idx === -1 ? 100 : idx + 1
}

interface UsageDatum {
  tokens: number
  cost: number
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  priceStatus?: 'configured' | 'partial' | 'unconfigured'
  billingMode?: 'per_token' | 'free' | 'subscription_monthly' | 'use_default' | 'unconfigured' | 'mixed'
}
type PulseAppId = string
interface LocalAiUsageItem {
  id: string
  name: string
  type: string
  path?: string
  project?: string
  model?: string
  usage: UsageDatum
  byModel?: ModelUsageMap
  updatedAt?: string
  lastActivityMs?: number
  exists?: boolean
}
interface LocalAiUsageApp {
  id: PulseAppId
  name: string
  itemLabel: string
  count?: number
  usage: UsageDatum
  byModel?: ModelUsageMap
  items: LocalAiUsageItem[]
  updatedAt?: string
  lastActivityMs?: number
}
type UnifiedStatus = Exclude<PulseStatusFilter, 'all'>
interface LocalAiStatusItem {
  app: PulseAppId
  conversationId: string
  project: string
  status: UnifiedStatus
  label: string
  reason?: string
  lastActivityMs?: number
  msAgo?: number | null
}
interface PulseRow {
  key: string
  kind: PulseAppId
  agent?: AgentInfo
  name: string
  project?: string
  projectScope?: ProjectTokenScope
  avatarSrc: string
  avatarText: string
  statusLabel: string
  statusClass: string
  status?: UnifiedStatus
  statusReason?: string
  lastActivityMs?: number
  usage: UsageDatum
  usageValue: number
  tokenText: string
  costText: string
  metricText: string
}
interface PulseApp {
  id: PulseAppId
  name: string
  iconSrc: string
  headline: string
  countText: string
  metricText: string
  usage: UsageDatum
  rows: PulseRow[]
}
type ModelUsageMap = Record<string, UsageDatum>
interface TimelineDay {
  date: string
  tokens: number
  cost: number
  priceStatus?: UsageDatum['priceStatus']
  billingMode?: UsageDatum['billingMode']
  byModel?: ModelUsageMap
  byAgentByModel?: Record<string, ModelUsageMap>
}
type TokenMiniRangeValue = 'today' | '3d' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom' | 'all'
type SummaryUsageRangeValue = Exclude<TokenMiniRangeValue, 'custom'>
type TokenMiniSeriesKey = 'tokens' | 'cost'
type TokenMiniMetric = TokenMiniSeriesKey | 'both'
type PulseStatusFilter = 'all' | 'running' | 'idle' | 'aborted' | 'error'
type MonitorStatusFilter = PulseStatusFilter
type MonitorObjectStatus = Exclude<PulseStatusFilter, 'all'>
interface MonitorObjectRow extends PulseRow {
  monitorKey: string
  sourceName: string
  sourceIconSrc: string
  monitorStatus: MonitorObjectStatus
  lastActivityText: string
  hidden: boolean
}

const MODEL_COLOR_PALETTE = ['#0a84ff', '#30d158', '#ff9f0a', '#cf7ef5', '#fb7185', '#30d158']
const MODEL_COLOR_MAP: Record<string, string> = safeRecordFrom({
  'deepseek-v4-flash': '#0a84ff',
  'deepseek-v4-pro': '#0a84ff',
  'deepseek-chat': '#0a84ff',
  'deepseek-reasoner': '#0a84ff',
  'MiniMax-M2.7': '#30d158',
  'gpt-5.3-codex': '#ff9f0a',
  'gpt-5.4': '#ff9f0a',
  'gpt-5.4-mini': '#ffcc00',
  'gpt-5.4-nano': '#ffd60a',
  'gpt-5.5': '#ff9f0a',
  'gpt-5.5-pro': '#ff9f0a',
  'gpt-5.6-sol': '#ff9f0a',
  'gpt-5.6-terra': '#ffb340',
  'gpt-5.6-luna': '#ffd60a',
  'claude-fable-5': '#cf7ef5',
  'claude-opus-4-8': '#cf7ef5',
  'claude-sonnet-5': '#cf7ef5',
  'claude-haiku-4-5': '#cf7ef5',
  'claude-sonnet-4-6': '#cf7ef5',
  'claude-sonnet-4-5': '#cf7ef5',
  'claude-opus-4-7': '#cf7ef5',
})
const TOKEN_MINI_RANGES: Array<{ value: TokenMiniRangeValue; label: string }> = [
  { value: 'today', label: '今天' },
  { value: '3d', label: '3 天' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'month', label: '本月' },
  { value: 'lastMonth', label: '上个月' },
  { value: 'all', label: '全部' },
]
const DEFAULT_TOKEN_MINI_RANGE: TokenMiniRangeValue = 'today'
const TOKEN_MINI_RANGE_PREFERENCE_KEY = 'ai_workbench_dashboard_token_range_v1'
const SUMMARY_USAGE_RANGES: Array<{ value: SummaryUsageRangeValue; label: string }> = [
  { value: 'today', label: '今天' },
  { value: '3d', label: '近 3 天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'month', label: '本月' },
  { value: 'lastMonth', label: '上个月' },
  { value: 'all', label: '全部' },
]
const DEFAULT_SUMMARY_USAGE_RANGE: SummaryUsageRangeValue = 'month'
const SUMMARY_USAGE_RANGE_PREFERENCE_KEY = 'ai_workbench_dashboard_summary_range_v1'
const TOKEN_USAGE_PREWARM_INTERVAL_MS = 5 * 60 * 1000
const TOKEN_METRIC_COLOR = '#0a84ff'
const COST_METRIC_COLOR = '#30d158'
const USD_TO_CNY_RATE = 7.2
// 画布尺寸 = 容器真实像素(ResizeObserver 同步),SVG 1:1 渲染,文字图形永不变形
const TOKEN_MINI_SVG_W = ref(620)
const TOKEN_MINI_SVG_H = ref(224)
const tokenMiniPlotEl = ref<HTMLElement | null>(null)
// RO 必须在 watch 首次触发前就绪(watch 先于 onMounted 执行)
const tokenMiniRO: ResizeObserver | null = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.round(e.contentRect.width)
        const h = Math.round(e.contentRect.height)
        if (w > 60) TOKEN_MINI_SVG_W.value = w
        if (h > 50) TOKEN_MINI_SVG_H.value = h
      }
    })
  : null
function syncTokenMiniSize(): void {
  const el = tokenMiniPlotEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  if (r.width > 60) TOKEN_MINI_SVG_W.value = Math.round(r.width)
  if (r.height > 50) TOKEN_MINI_SVG_H.value = Math.round(r.height)
}
// 容器在 v-if 内,出现/消失时动态挂接观察;RO 失效环境用直读兜底
watch(tokenMiniPlotEl, (el, old) => {
  if (old && tokenMiniRO) tokenMiniRO.unobserve(old)
  if (el && tokenMiniRO) tokenMiniRO.observe(el)
  if (el) { setTimeout(syncTokenMiniSize, 0); setTimeout(syncTokenMiniSize, 250) }
})
onMounted(() => {
  window.addEventListener('resize', syncTokenMiniSize)
  setTimeout(syncTokenMiniSize, 0)
  setTimeout(syncTokenMiniSize, 300)
})
onUnmounted(() => {
  tokenMiniRO?.disconnect()
  window.removeEventListener('resize', syncTokenMiniSize)
})

// 左轴内边距:按当前最长刻度标签宽度动态收缩(token模式短标签不再留大白边)
function estLabelW(t: string): number {
  let w = 0
  for (const ch of t) w += /[亿万]/.test(ch) ? 11 : ch === '¥' ? 7 : 6
  return w
}
const TOKEN_MINI_PAD_L = computed(() => {
  const labels = tokenMiniAxisLeft.value.map((t) => t.text)
  const maxW = labels.length ? Math.max(...labels.map(estLabelW)) : 16
  return Math.min(54, Math.max(24, Math.round(maxW + 10)))
})
const TOKEN_MINI_PAD_T = 18
const TOKEN_MINI_PAD_B = 20
// 双指标时右侧给费用刻度留位
const TOKEN_MINI_PAD_R = computed(() => {
  if (tokenMiniMetric.value !== 'both') return 14
  const labels = tokenMiniAxisRight.value.map((t) => t.text)
  const maxW = labels.length ? Math.max(...labels.map(estLabelW)) : 28
  return Math.min(50, Math.max(20, Math.round(maxW + 8)))
})
const TOKEN_MINI_PLOT_H = computed(() => TOKEN_MINI_SVG_H.value - TOKEN_MINI_PAD_T - TOKEN_MINI_PAD_B)

// 整数化坐标轴:把最大值抬到 1/2/2.5/5×10^k 的整洁刻度
// 紧贴峰值的整洁刻度:max 是恰好罩住峰值的最小整洁值,刻度为 step 整数倍
function niceScaleTight(raw: number, tickTarget = 4): { max: number; step: number; ticks: number[] } {
  if (raw <= 0) return { max: 1, step: 1, ticks: [0, 1] }
  const rawStep = raw / tickTarget
  const exp = Math.floor(Math.log10(rawStep))
  const base = Math.pow(10, exp)
  const m = rawStep / base
  const niceM = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10
  const step = niceM * base
  const max = Math.ceil(raw / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 1e-6; v += step) ticks.push(v)
  return { max, step, ticks }
}
// 轴刻度专用:整数优先,最多1位小数,无空格
function fmtAxisInt(v: number, isCost: boolean): string {
  if (v <= 0) return isCost ? '¥0' : '0'
  if (isCost) return `¥${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}`
  const units: Array<[number, string]> = [[1e8, '亿'], [1e4, '万']]
  for (const [u, label] of units) {
    if (v >= u) {
      const n = Math.round((v / u) * 10) / 10
      return `${n % 1 === 0 ? Math.round(n) : n}${label}`
    }
  }
  return String(Math.round(v))
}

const tokenMiniScale = computed(() => ({
  tokens: niceScaleTight(tokenMiniChartMaxFor('tokens')),
  cost: niceScaleTight(tokenMiniChartMaxFor('cost')),
}))
const tokenMiniRange = ref<TokenMiniRangeValue>(DEFAULT_TOKEN_MINI_RANGE)
const tokenMiniCustomRange = ref<[string, string] | null>(null)
const tokenMiniCustomRangeDraft = ref<string[]>([])
const tokenMiniMetricKeys = ref<TokenMiniSeriesKey[]>(['tokens', 'cost'])
const tokenMiniMetric = computed<TokenMiniMetric>(() => {
  const keys = tokenMiniMetricKeys.value
  if (keys.includes('tokens') && keys.includes('cost')) return 'both'
  return keys.includes('cost') ? 'cost' : 'tokens'
})
const tokenMiniCurrentMetricColor = computed(() => (
  tokenMiniMetric.value === 'cost' ? COST_METRIC_COLOR : TOKEN_METRIC_COLOR
))
const tokenMiniTimeline = ref<TimelineDay[]>([])
const tokenUsageSnapshotLoading = ref(false)
const tokenUsageSnapshotBlocking = ref(true)
const tokenUsageSnapshotReady = ref(false)
const tokenUsageSnapshotServerRefreshing = ref(false)
const tokenUsageSnapshotRange = ref<TokenMiniRangeValue>(DEFAULT_TOKEN_MINI_RANGE)
const tokenUsageSnapshotCustomRange = ref<[string, string] | null>(null)
const tokenMiniLoading = computed(() => tokenUsageSnapshotBlocking.value)
const tokenMiniSelectedModels = ref<string[]>([])
const tokenMiniHoverIndex = ref<number | null>(null)
const localAiUsageApps = ref<LocalAiUsageApp[]>([])
const localAiUsageTimeline = ref<TimelineDay[]>([])
const localAiUsageLoading = computed(() => tokenUsageSnapshotLoading.value)
const summaryUsageRange = ref<SummaryUsageRangeValue>(DEFAULT_SUMMARY_USAGE_RANGE)
const summaryUsagePublishedRange = ref<SummaryUsageRangeValue>(DEFAULT_SUMMARY_USAGE_RANGE)
const summaryUsageTimeline = ref<TimelineDay[]>([])
const summaryUsageReady = ref(false)
const summaryUsageLoading = ref(false)
const localAiStatusMap = ref<Record<string, LocalAiStatusItem>>(createSafeRecord())
const aiToolRegistry = createAiToolRegistry(DEFAULT_AI_TOOLS)
const selectedPulseAppId = ref<PulseAppId>('openclaw')
const pulseStatusFilter = ref<PulseStatusFilter>('all')
const agentPulseCardEl = ref<HTMLElement | null>(null)
const monitorObjectsDialogVisible = ref(false)
const monitorDetailStatus = ref<MonitorStatusFilter>('all')
const monitorShowHidden = ref(false)
const monitorSourceFilter = ref<PulseAppId[]>(DEFAULT_AI_TOOLS.map((tool) => tool.id))
const monitorHiddenKeys = ref<string[]>([])
let localAiUsageTimer: ReturnType<typeof setInterval> | null = null
let tokenUsagePrewarmTimer: ReturnType<typeof setInterval> | null = null
let tokenUsagePrewarmInFlight: Promise<boolean> | null = null
let tokenUsageSnapshotRefreshTimer: ReturnType<typeof setTimeout> | null = null
let tokenUsageSnapshotRequestId = 0
let tokenUsageSnapshotAbortController: AbortController | null = null
let summaryUsageRequestId = 0
let summaryUsageAbortController: AbortController | null = null
let localAiStatusTimer: ReturnType<typeof setInterval> | null = null

function toggleTokenMiniMetric(metric: TokenMiniSeriesKey): void {
  const next = new Set(tokenMiniMetricKeys.value)
  if (next.has(metric)) next.delete(metric)
  else next.add(metric)
  if (next.size === 0) next.add(metric)
  tokenMiniMetricKeys.value = (['tokens', 'cost'] as TokenMiniSeriesKey[]).filter((key) => next.has(key))
}

function getAgentId(agent: AgentInfo): string {
  const parts = (agent.key || '').split(':')
  return (parts[0] === 'agent' && parts.length >= 2) ? parts[1] : parts[0]
}

function stripAgentEmoji(name: string): string {
  return name.replace(/^\p{Extended_Pictographic}(?:\uFE0F)?\s*/u, '').trim()
}

function getAgentDisplayName(agent: AgentInfo): string {
  return stripAgentEmoji(agent.displayName || agent.label || agent.name || getAgentId(agent) || 'Unknown')
}

function getAgentAvatarSrc(agent: AgentInfo): string {
  return normalizeAgentAvatarSource(agent.avatar)
}

const RECENT_AGENT_ACTIVITY_MS = 30 * 1000

function isRecentlyActive(agent: AgentInfo): boolean {
  if (agent.status === 'running') return true
  if (!agent.lastActivity) return false
  return Date.now() - agent.lastActivity < RECENT_AGENT_ACTIVITY_MS
}

function getAgentStatusLabel(agent: AgentInfo): string {
  if (agent.status === 'running') return '正在干活'
  if (agent.status === 'error') return '报错'
  if (agent.status === 'aborted') return '已终止'
  if (isRecentlyActive(agent)) return '刚动过'
  if (agent.status === 'idle') return '没干活'
  return '未知'
}

function getAgentStatusClass(agent: AgentInfo): string {
  if (agent.status === 'running') return 'is-running'
  if (agent.status === 'error') return 'is-error'
  if (agent.status === 'aborted') return 'is-aborted'
  if (isRecentlyActive(agent)) return 'is-recent'
  return 'is-idle'
}

function getModelDisplayLabel(model: string): string {
  const names: Record<string, string> = safeRecordFrom({
    'deepseek-v4-flash': 'DeepSeek',
    'deepseek-v4-pro': 'DeepSeek',
    'deepseek-v3': 'DeepSeek',
    'deepseek-chat': 'DeepSeek',
    'deepseek-reasoner': 'DeepSeek',
    'MiniMax-M2.7': 'MiniMax',
    'claude-fable-5': 'Claude',
    'claude-opus-4-8': 'Claude',
    'claude-sonnet-5': 'Claude',
    'claude-haiku-4-5': 'Claude',
    'claude-sonnet-4-6': 'Claude',
    'claude-sonnet-4-5': 'Claude',
    'claude-opus-4': 'Claude',
    'claude-opus-4-6': 'Claude',
    'claude-opus-4-7': 'Claude',
    'claude-opus-4-5': 'Claude',
    'chat-latest': 'ChatGPT',
    'gpt-5.3-codex': 'Codex',
    'gpt-5.4': 'GPT-5.4',
    'gpt-5.4-mini': 'GPT-5.4 Mini',
    'gpt-5.4-nano': 'GPT-5.4 Nano',
    'gpt-5.4-pro': 'GPT-5.4 Pro',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.5-pro': 'GPT-5.5 Pro',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'gpt-5.6-terra': 'GPT-5.6 Terra',
    'gpt-5.6-luna': 'GPT-5.6 Luna',
    'Qwen3.5-4B-OptiQ-4bit': '本地 Qwen3.5 4B',
    'qwen3.5': '本地 Qwen3.5',
    'qwen3.5:9b': '本地 Qwen3.5 9B',
    'qwen2.5': '本地 Qwen2.5',
    'gemma3:12b': '本地 Gemma 3 12B',
  })
  const lower = String(model || '').toLowerCase()
  if (lower.includes('qwen')) return `本地千问 ${model.replace(/^.*qwen/i, 'Qwen')}`
  if (lower.includes('gemma')) return `本地 Google ${model.replace(/^.*gemma/i, 'Gemma')}`
  return ownValue(names, model) || model.split('/').pop() || model
}

function getModelColor(model: string, index = 0): string {
  return ownValue(MODEL_COLOR_MAP, model) || MODEL_COLOR_PALETTE[index % MODEL_COLOR_PALETTE.length]
}

function getModelLogoKey(model: string): string {
  const m = String(model || '').toLowerCase()
  if (m.includes('deepseek')) return 'deepseek'
  if (m.includes('minimax')) return 'minimax'
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic'
  if (m.includes('gpt') || m.includes('openai')) return 'openai'
  if (m.includes('qwen')) return 'qwen'
  if (m.includes('gemma') || m.includes('google')) return 'google'
  if (m.includes('ollama') || m.includes('local') || m.includes('本地')) return 'local'
  return 'generic'
}

function getModelLogoText(model: string): string {
  const key = getModelLogoKey(model)
  if (key === 'deepseek') return 'DS'
  if (key === 'minimax') return 'MM'
  if (key === 'anthropic') return 'A'
  if (key === 'openai') return 'AI'
  if (key === 'qwen') return '千'
  if (key === 'google') return 'G'
  if (key === 'local') return '本'
  return 'M'
}

function getModelLogoSrc(model: string): string {
  const key = getModelLogoKey(model)
  if (['deepseek', 'minimax', 'anthropic', 'openai', 'qwen', 'google'].includes(key)) {
    return `/model-logos/${key}.svg`
  }
  return ''
}

function getModelCompanyName(model: string): string {
  const key = getModelLogoKey(model)
  if (key === 'deepseek') return 'DeepSeek'
  if (key === 'minimax') return 'MiniMax'
  if (key === 'anthropic') return 'Anthropic / Claude'
  if (key === 'openai') return 'OpenAI'
  if (key === 'qwen') return 'Alibaba Qwen'
  if (key === 'google') return 'Google'
  if (key === 'local') return '本地模型'
  return getModelDisplayLabel(model)
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatShortDate(dateKey: string): string {
  const hourMatch = String(dateKey || '').match(/^\d{4}-\d{2}-\d{2}\s+(\d{2}):/)
  if (hourMatch) return `${hourMatch[1]}:00`
  const parts = dateKey.split('-')
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : dateKey
}

function timelineDatePart(dateKey: string): string {
  const match = String(dateKey || '').match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : dateKey
}

function startOfLocalDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function dateKeyToTime(dateKey: string): number {
  const text = String(dateKey || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00`).getTime()
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)) return new Date(text.replace(' ', 'T')).getTime()
  return Date.parse(text)
}

function normalizeDateRange(value: string[] | null | undefined): [string, string] | null {
  if (!Array.isArray(value) || value.length < 2 || !value[0] || !value[1]) return null
  const [first, second] = value
  const firstTime = dateKeyToTime(first)
  const secondTime = dateKeyToTime(second)
  if (!Number.isFinite(firstTime) || !Number.isFinite(secondTime)) return null
  return firstTime <= secondTime ? [first, second] : [second, first]
}

function isTokenMiniRangeValue(value: unknown): value is TokenMiniRangeValue {
  return value === 'custom' || TOKEN_MINI_RANGES.some((option) => option.value === value)
}

function saveTokenMiniRangePreference(): void {
  try {
    localStorage.setItem(TOKEN_MINI_RANGE_PREFERENCE_KEY, JSON.stringify({
      range: tokenMiniRange.value,
      customRange: tokenMiniRange.value === 'custom' ? tokenMiniCustomRange.value : null,
    }))
  } catch {
    // 浏览器禁用本地存储时仍可正常使用当前页面。
  }
}

function loadTokenMiniRangePreference(): void {
  try {
    const raw = localStorage.getItem(TOKEN_MINI_RANGE_PREFERENCE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { range?: unknown; customRange?: unknown }
    if (!isTokenMiniRangeValue(saved.range)) throw new Error('invalid_range')

    if (saved.range === 'custom') {
      const customRange = normalizeDateRange(Array.isArray(saved.customRange) ? saved.customRange : null)
      if (!customRange) throw new Error('invalid_custom_range')
      tokenMiniCustomRange.value = customRange
      tokenMiniCustomRangeDraft.value = [...customRange]
    }
    tokenMiniRange.value = saved.range
  } catch {
    tokenMiniRange.value = DEFAULT_TOKEN_MINI_RANGE
    tokenMiniCustomRange.value = null
    tokenMiniCustomRangeDraft.value = []
    try { localStorage.removeItem(TOKEN_MINI_RANGE_PREFERENCE_KEY) } catch { /* ignore */ }
  }
}

loadTokenMiniRangePreference()

function isSummaryUsageRangeValue(value: unknown): value is SummaryUsageRangeValue {
  return SUMMARY_USAGE_RANGES.some((option) => option.value === value)
}

function saveSummaryUsageRangePreference(): void {
  try {
    localStorage.setItem(SUMMARY_USAGE_RANGE_PREFERENCE_KEY, summaryUsageRange.value)
  } catch {
    // 浏览器禁用本地存储时仍可正常使用当前页面。
  }
}

function loadSummaryUsageRangePreference(): void {
  try {
    const saved = localStorage.getItem(SUMMARY_USAGE_RANGE_PREFERENCE_KEY)
    if (!saved) return
    if (!isSummaryUsageRangeValue(saved)) throw new Error('invalid_summary_range')
    summaryUsageRange.value = saved
  } catch {
    summaryUsageRange.value = DEFAULT_SUMMARY_USAGE_RANGE
    try { localStorage.removeItem(SUMMARY_USAGE_RANGE_PREFERENCE_KEY) } catch { /* ignore */ }
  }
}

loadSummaryUsageRangePreference()

function getTokenMiniRequestDays(
  range: TokenMiniRangeValue,
  customRange: [string, string] | null = tokenMiniCustomRange.value,
): number | 'all' {
  const today = startOfLocalDay(new Date())
  if (range === 'today') return 1
  if (range === '3d') return 3
  if (range === '7d') return 7
  if (range === '30d') return 30
  if (range === 'month') return today.getDate()
  if (range === 'lastMonth') {
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    return Math.min(90, Math.max(1, Math.ceil((today.getTime() - lastMonthStart.getTime()) / 86400_000) + 1))
  }
  if (range === 'custom') {
    const start = customRange?.[0]
    if (!start) return 'all'
    const startTime = dateKeyToTime(start)
    if (!Number.isFinite(startTime)) return 'all'
    const days = Math.max(1, Math.ceil((today.getTime() - startTime) / 86400_000) + 1)
    return days > 90 ? 'all' : days
  }
  return 'all'
}

function setTokenMiniRange(range: TokenMiniRangeValue): void {
  tokenMiniRange.value = range
  saveTokenMiniRangePreference()
  void refreshTokenUsageSnapshot()
}

function setTokenMiniCustomRange(value: string[] | null): void {
  const normalized = normalizeDateRange(value)
  if (!normalized) {
    tokenMiniCustomRange.value = null
    tokenMiniCustomRangeDraft.value = []
    if (tokenMiniRange.value === 'custom') setTokenMiniRange(DEFAULT_TOKEN_MINI_RANGE)
    return
  }
  tokenMiniCustomRange.value = normalized
  tokenMiniCustomRangeDraft.value = [...normalized]
  tokenMiniRange.value = 'custom'
  saveTokenMiniRangePreference()
  void refreshTokenUsageSnapshot()
}

function localAiUsageQuery(
  range: TokenMiniRangeValue = tokenMiniRange.value,
  customRange: [string, string] | null = tokenMiniCustomRange.value,
): string {
  const today = startOfLocalDay(new Date())
  const makeRange = (start: Date, end: Date = today) => (
    `start=${encodeURIComponent(formatDateKey(start))}&end=${encodeURIComponent(formatDateKey(end))}`
  )

  if (range === 'today') return `${makeRange(today)}&granularity=hour`
  if (range === '3d') return `days=3`
  if (range === '7d') return `days=7`
  if (range === '30d') return `days=30`
  if (range === 'month') return makeRange(new Date(today.getFullYear(), today.getMonth(), 1))
  if (range === 'lastMonth') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const end = new Date(today.getFullYear(), today.getMonth(), 0)
    return makeRange(start, end)
  }
  if (range === 'custom' && customRange) {
    return `start=${encodeURIComponent(customRange[0])}&end=${encodeURIComponent(customRange[1])}`
  }
  return 'days=all'
}

function tokenUsageRequestUrls(
  range: TokenMiniRangeValue,
  customRange: [string, string] | null,
  options: { force?: boolean, prewarm?: boolean } = {},
): { timelineUrl: string, localUsageUrl: string } {
  const days = getTokenMiniRequestDays(range, customRange)
  const granularityQuery = range === 'today' ? '&granularity=hour' : ''
  const prewarmQuery = options.prewarm === true ? '&prewarm=1' : ''
  const forceRefreshQuery = options.force === true ? '&refresh=1' : ''
  return {
    timelineUrl: `/api/cost-timeline?days=${encodeURIComponent(String(days))}${granularityQuery}${prewarmQuery}`,
    localUsageUrl: `/api/local-ai-usage?${localAiUsageQuery(range, customRange)}${forceRefreshQuery}${prewarmQuery}`,
  }
}

function tokenUsageRangeDescription(
  range: TokenMiniRangeValue,
  customRange: [string, string] | null,
): string {
  if (range === 'custom' && customRange) return `${customRange[0]} 至 ${customRange[1]}`
  return TOKEN_MINI_RANGES.find(option => option.value === range)?.label || '全部'
}

function isTimelineDateInRange(
  dateKey: string,
  range: TokenMiniRangeValue,
  customRange: [string, string] | null = null,
): boolean {
  if (range === 'all') return true
  const today = startOfLocalDay(new Date())
  const target = dateKeyToTime(timelineDatePart(dateKey))
  if (!Number.isFinite(target)) return false
  if (range === 'today') return target === today.getTime()
  if (range === '3d') return target >= addDays(today, -2).getTime() && target <= today.getTime()
  if (range === '7d') return target >= addDays(today, -6).getTime() && target <= today.getTime()
  if (range === '30d') return target >= addDays(today, -29).getTime() && target <= today.getTime()
  if (range === 'month') {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime()
    return target >= monthStart && target <= today.getTime()
  }
  if (range === 'lastMonth') {
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime()
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime()
    return target >= lastMonthStart && target < monthStart
  }
  if (range === 'custom' && customRange) {
    const start = dateKeyToTime(customRange[0])
    const end = dateKeyToTime(customRange[1])
    return target >= start && target <= end
  }
  return false
}

function prewarmTokenUsageRanges(): Promise<boolean> {
  if (tokenUsagePrewarmInFlight) return tokenUsagePrewarmInFlight

  const task = (async () => {
    for (const option of TOKEN_MINI_RANGES) {
      const { timelineUrl, localUsageUrl } = tokenUsageRequestUrls(option.value, null, { prewarm: true })
      const result = await usageStatisticsManager.load({
        timelineUrl,
        localUsageUrl,
        scopeKey: `usage:${option.value}`,
        rangeLabel: option.label,
        hasPublishedData: tokenUsageSnapshotReady.value,
        prewarm: true,
      })
      if (!result.ok) {
        if (result.failure?.kind === 'model_error') return false
        if (result.failure?.kind !== 'service_unavailable') return false
      }
    }
    return true
  })().finally(() => {
    if (tokenUsagePrewarmInFlight === task) tokenUsagePrewarmInFlight = null
  })

  tokenUsagePrewarmInFlight = task
  return task
}

async function refreshTokenUsageSnapshot(options: { blocking?: boolean, force?: boolean } = {}): Promise<boolean> {
  const requestId = ++tokenUsageSnapshotRequestId
  if (tokenUsageSnapshotRefreshTimer) {
    clearTimeout(tokenUsageSnapshotRefreshTimer)
    tokenUsageSnapshotRefreshTimer = null
  }
  tokenUsageSnapshotAbortController?.abort()
  const controller = new AbortController()
  tokenUsageSnapshotAbortController = controller

  const range = tokenMiniRange.value
  const customRange = tokenMiniCustomRange.value ? [...tokenMiniCustomRange.value] as [string, string] : null
  const { timelineUrl, localUsageUrl } = tokenUsageRequestUrls(range, customRange, { force: options.force })
  const blocking = options.blocking === true || !tokenUsageSnapshotReady.value || tokenUsageSnapshotBlocking.value

  tokenUsageSnapshotLoading.value = true
  tokenUsageSnapshotBlocking.value = blocking
  try {
    const result = await usageStatisticsManager.load({
      timelineUrl,
      localUsageUrl,
      signal: controller.signal,
      scopeKey: `usage:${range}`,
      rangeLabel: tokenUsageRangeDescription(range, customRange),
      hasPublishedData: tokenUsageSnapshotReady.value,
    })
    if (!result.ok) return false
    if (requestId !== tokenUsageSnapshotRequestId) return false
    const timelineData = result.timelineData || {}
    const localUsageData = result.localUsageData || {}

    // Vue 会在同一轮更新中提交这三项，页面不会先展示 OpenClaw 的部分结果。
    tokenMiniTimeline.value = Array.isArray(timelineData.timeline) ? timelineData.timeline : []
    localAiUsageApps.value = Array.isArray(localUsageData.apps) ? localUsageData.apps : []
    localAiUsageTimeline.value = Array.isArray(localUsageData.timeline) ? localUsageData.timeline : []
    tokenUsageSnapshotRange.value = range
    tokenUsageSnapshotCustomRange.value = customRange ? [...customRange] : null
    tokenUsageSnapshotReady.value = true
    const cacheState = localUsageData?.cache as {
      refreshing?: boolean
      refreshFailed?: boolean
    } | undefined
    tokenUsageSnapshotServerRefreshing.value = cacheState?.refreshing === true
    if (cacheState?.refreshFailed !== true && cacheState?.refreshing === true) {
      tokenUsageSnapshotRefreshTimer = setTimeout(() => {
        tokenUsageSnapshotRefreshTimer = null
        if (requestId === tokenUsageSnapshotRequestId) void refreshTokenUsageSnapshot()
      }, 10 * 1000)
    }
    return result.refreshFailed !== true
  } catch {
    if (controller.signal.aborted || requestId !== tokenUsageSnapshotRequestId) return false
    tokenUsageSnapshotServerRefreshing.value = false
    return false
  } finally {
    if (requestId === tokenUsageSnapshotRequestId) {
      tokenUsageSnapshotLoading.value = false
      tokenUsageSnapshotBlocking.value = false
      tokenUsageSnapshotAbortController = null
    }
  }
}

async function refreshSummaryUsage(): Promise<boolean> {
  const requestId = ++summaryUsageRequestId
  summaryUsageAbortController?.abort()
  const controller = new AbortController()
  summaryUsageAbortController = controller
  const range = summaryUsageRange.value
  const { timelineUrl, localUsageUrl } = tokenUsageRequestUrls(range, null)
  summaryUsageLoading.value = true

  try {
    const rangeLabel = SUMMARY_USAGE_RANGES.find((option) => option.value === range)?.label || '本月'
    const result = await usageStatisticsManager.load({
      timelineUrl,
      localUsageUrl,
      signal: controller.signal,
      scopeKey: `usage:${range}`,
      rangeLabel,
      hasPublishedData: summaryUsageReady.value,
    })
    if (!result.ok) {
      if (summaryUsageReady.value) {
        summaryUsageRange.value = summaryUsagePublishedRange.value
        saveSummaryUsageRangePreference()
      }
      return false
    }
    if (requestId !== summaryUsageRequestId) return false
    const timelineData = result.timelineData || {}
    const localUsageData = result.localUsageData || {}

    const openClawTimeline = Array.isArray(timelineData.timeline) ? timelineData.timeline : []
    const localTimeline = Array.isArray(localUsageData.timeline) ? localUsageData.timeline : []
    summaryUsageTimeline.value = (mergeUsageTimelines(openClawTimeline, localTimeline) as TimelineDay[])
      .filter((day) => isTimelineDateInRange(day.date, range))
    summaryUsagePublishedRange.value = range
    summaryUsageReady.value = true
    return result.refreshFailed !== true
  } catch {
    if (controller.signal.aborted || requestId !== summaryUsageRequestId) return false
    if (summaryUsageReady.value) {
      summaryUsageRange.value = summaryUsagePublishedRange.value
      saveSummaryUsageRangePreference()
    }
    return false
  } finally {
    if (requestId === summaryUsageRequestId) {
      summaryUsageLoading.value = false
      summaryUsageAbortController = null
    }
  }
}

function setSummaryUsageRange(range: SummaryUsageRangeValue): void {
  summaryUsageRange.value = range
  saveSummaryUsageRangePreference()
  summaryUsageDialogVisible.value = false
  void refreshSummaryUsage()
}

function localStatusClass(status: UnifiedStatus, label?: string): string {
  if (status === 'running') return 'is-running'
  if (status === 'error') return 'is-error'
  if (status === 'aborted') return 'is-aborted'
  if (label === '刚动过') return 'is-recent'
  return 'is-idle'
}

function fallbackLocalStatus(item: LocalAiUsageItem): Pick<LocalAiStatusItem, 'status' | 'label' | 'lastActivityMs'> {
  const lastActivityMs = Number(item.lastActivityMs) || (item.updatedAt ? Date.parse(item.updatedAt) : 0)
  const label = getLocalUsageStatusLabel(item)
  return {
    status: 'idle',
    label,
    lastActivityMs,
  }
}

function findLocalAiStatus(item: LocalAiUsageItem): LocalAiStatusItem | null {
  const conversationId = String(item.id || '').trim()
  return conversationId ? ownValue(localAiStatusMap.value, conversationId) || null : null
}

async function fetchLocalAiStatus(): Promise<void> {
  try {
    const res = await fetch('/api/local-ai-status')
    if (!res.ok) return
    const data = await res.json()
    const next: Record<string, LocalAiStatusItem> = createSafeRecord()
    for (const row of (Array.isArray(data.statuses) ? data.statuses : [])) {
      if (!row?.app || !row?.conversationId || !row?.status) continue
      const item: LocalAiStatusItem = {
        app: row.app,
        conversationId: String(row.conversationId),
        project: String(row.project || ''),
        status: row.status,
        label: row.label || row.status,
        reason: row.reason || '',
        lastActivityMs: Number(row.lastActivityMs) || 0,
        msAgo: typeof row.msAgo === 'number' ? row.msAgo : null,
      }
      next[item.conversationId] = item
    }
    localAiStatusMap.value = next
  } catch {
    // 状态接口失败时保留旧值，避免 UI 闪烁或误报。
  }
}

function cloneUsage(usage: Partial<UsageDatum> | undefined): UsageDatum {
  return {
    tokens: Number(usage?.tokens) || 0,
    cost: Number(usage?.cost) || 0,
    input: Number(usage?.input) || 0,
    output: Number(usage?.output) || 0,
    cacheRead: Number(usage?.cacheRead) || 0,
    cacheWrite: Number(usage?.cacheWrite) || 0,
    priceStatus: usage?.priceStatus,
    billingMode: usage?.billingMode,
  }
}

function emptyUsage(): UsageDatum {
  return cloneUsage(undefined)
}

function addUsage(target: UsageDatum, usage: Partial<UsageDatum> | undefined): void {
  if (!usage) return
  target.tokens += Number(usage.tokens) || 0
  target.cost += Number(usage.cost) || 0
  target.input = (Number(target.input) || 0) + (Number(usage.input) || 0)
  target.output = (Number(target.output) || 0) + (Number(usage.output) || 0)
  target.cacheRead = (Number(target.cacheRead) || 0) + (Number(usage.cacheRead) || 0)
  target.cacheWrite = (Number(target.cacheWrite) || 0) + (Number(usage.cacheWrite) || 0)
  if (usage.priceStatus) {
    target.priceStatus = !target.priceStatus || target.priceStatus === usage.priceStatus
      ? usage.priceStatus
      : 'partial'
  }
  if (usage.billingMode) {
    target.billingMode = !target.billingMode || target.billingMode === usage.billingMode
      ? usage.billingMode
      : 'mixed'
  }
}

function usageMetricValue(usage: UsageDatum): number {
  return tokenMiniMetric.value === 'cost' ? usage.cost : usage.tokens
}

function formatCostScope(cost: number, priceStatus?: UsageDatum['priceStatus'], billingMode?: UsageDatum['billingMode']): string {
  if (priceStatus === 'unconfigured') return '价格未配置'
  if (priceStatus === 'partial') {
    const configuredCost = cost > 0 ? (cost < 0.01 ? '<¥0.01' : `¥${cost.toFixed(2)}`) : '¥0'
    return `部分价格未配置 · ${configuredCost}`
  }
  if (billingMode === 'free') return '¥0（免费）'
  if (!cost || cost <= 0) return '¥0'
  if (cost < 0.01) return '<¥0.01'
  return `¥${cost.toFixed(2)}`
}

function formatUsdScope(costCny: number, priceStatus?: UsageDatum['priceStatus']): string {
  if (priceStatus === 'unconfigured') return '价格未配置'
  const costUsd = (Number(costCny) || 0) / USD_TO_CNY_RATE
  if (priceStatus === 'partial') {
    const configuredCost = costUsd > 0 ? (costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`) : '$0'
    return `部分未配置 · ${configuredCost}`
  }
  if (!costUsd || costUsd <= 0) return '$0'
  if (costUsd < 0.01) return '<$0.01'
  return `$${costUsd.toFixed(2)}`
}

function formatTokenMiniChartToken(value: number): string {
  const n = Number(value) || 0
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)} 亿`
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)} 千万`
  if (n >= 10_000) return `${(n / 10_000).toFixed(2)} 万`
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function formatTokenMiniChartCost(value: number): string {
  return `¥${(Number(value) || 0).toFixed(2)}`
}

function formatUsageByMetric(usage: UsageDatum): string {
  return tokenMiniMetric.value === 'cost' ? formatCostScope(usage.cost, usage.priceStatus, usage.billingMode) : formatTokenZh(usage.tokens)
}

function addUsageToMap(map: ModelUsageMap, model: string, usage: Partial<UsageDatum> | undefined): void {
  if (!Object.hasOwn(map, model)) map[model] = emptyUsage()
  addUsage(map[model], usage)
}

function isDateInTokenMiniRange(dateKey: string): boolean {
  const publishedRange = tokenUsageSnapshotRange.value
  return isTimelineDateInRange(dateKey, publishedRange, tokenUsageSnapshotCustomRange.value)
}

const tokenMiniMergedTimeline = computed<TimelineDay[]>(() => (
  mergeUsageTimelines(tokenMiniTimeline.value, localAiUsageTimeline.value) as TimelineDay[]
))

const tokenMiniRangeTimeline = computed<TimelineDay[]>(() => {
  return tokenMiniMergedTimeline.value.filter((day) => isDateInTokenMiniRange(day.date))
})

const tokenMiniSelectedModelSet = computed(() => new Set(tokenMiniSelectedModels.value))
const hasTokenMiniModelFilter = computed(() => tokenMiniSelectedModelSet.value.size > 0)

function isTokenMiniModelActive(model: string): boolean {
  return !hasTokenMiniModelFilter.value || tokenMiniSelectedModelSet.value.has(model)
}

function toggleTokenMiniModel(model: string): void {
  const next = new Set(tokenMiniSelectedModels.value)
  if (next.has(model)) next.delete(model)
  else next.add(model)
  tokenMiniSelectedModels.value = [...next]
}

const tokenMiniFilteredTimeline = computed<TimelineDay[]>(() => {
  if (!hasTokenMiniModelFilter.value) return tokenMiniRangeTimeline.value
  return tokenMiniRangeTimeline.value.map((day) => {
    const byModel: ModelUsageMap = createSafeRecord()
    const byModelEntries = Object.entries(day.byModel || {})
    if (byModelEntries.length === 0) {
      if (tokenMiniSelectedModelSet.value.has('unknown')) byModel.unknown = cloneUsage(day)
    } else {
      for (const [model, usage] of byModelEntries) {
        if (tokenMiniSelectedModelSet.value.has(model)) byModel[model] = cloneUsage(usage)
      }
    }
    for (const modelMap of Object.values(day.byAgentByModel || {})) {
      for (const [model, usage] of Object.entries(modelMap || {})) {
        if (tokenMiniSelectedModelSet.value.has(model) && !Object.hasOwn(byModel, model)) {
          addUsageToMap(byModel, model, usage)
        }
      }
    }
    const totals = Object.values(byModel).reduce(
      (sum, usage) => {
        addUsage(sum, usage)
        return sum
      },
      emptyUsage(),
    )
    return { ...day, ...totals, byModel }
  })
})

const tokenMiniTotals = computed(() => tokenMiniFilteredTimeline.value.reduce(
  (sum, day) => {
    addUsage(sum, day)
    return sum
  },
  emptyUsage(),
))

const tokenMiniRangeByModel = computed<ModelUsageMap>(() => {
  const out: ModelUsageMap = createSafeRecord()
  for (const day of tokenMiniRangeTimeline.value) {
    const entries = Object.entries(day.byModel || {})
    if (entries.length === 0) {
      if ((Number(day.tokens) || 0) > 0 || (Number(day.cost) || 0) > 0) addUsageToMap(out, 'unknown', day)
    }
    for (const [model, usage] of entries) addUsageToMap(out, model, usage)
    for (const modelMap of Object.values(day.byAgentByModel || {})) {
      for (const [model, usage] of Object.entries(modelMap || {})) {
        if (!Object.hasOwn(out, model)) addUsageToMap(out, model, usage)
      }
    }
  }
  return out
})

interface TokenMiniPoint {
  x: number
  y: number
  date: string
  tokens: number
  cost: number
}

const tokenMiniMetricLabel = computed(() => {
  if (tokenMiniMetric.value === 'both') return 'Token + API 等价费用'
  return tokenMiniMetric.value === 'tokens' ? 'Token' : 'API 等价费用'
})
const tokenMiniRangeLabel = computed(() => {
  const publishedRange = tokenUsageSnapshotRange.value
  if (publishedRange === 'custom') {
    const range = tokenUsageSnapshotCustomRange.value
    return range ? `${formatShortDate(range[0])}-${formatShortDate(range[1])}` : '自定义'
  }
  return TOKEN_MINI_RANGES.find((opt) => opt.value === publishedRange)?.label || '全部'
})
const contributionEyebrow = computed(() => tokenMiniMetric.value === 'cost' ? 'API 等价费用排行' : '贡献排行')
const contributionTitle = computed(() => tokenMiniMetric.value === 'cost' ? '谁最能花钱' : '谁最能干')
const contributionEmptyText = computed(() => tokenMiniMetric.value === 'cost' ? '暂无费用贡献数据' : '暂无 Token 贡献数据')
const contributionBarColor = computed(() => (
  tokenMiniMetric.value === 'cost' ? COST_METRIC_COLOR : TOKEN_METRIC_COLOR
))
const tokenMiniActiveSeriesKeys = computed<TokenMiniSeriesKey[]>(() => (
  tokenMiniMetric.value === 'both' ? ['tokens', 'cost'] : [tokenMiniMetric.value]
))

function tokenMiniChartValue(day: TimelineDay, metric: TokenMiniSeriesKey): number {
  return metric === 'cost' ? Number(day.cost) || 0 : Number(day.tokens) || 0
}

function tokenMiniChartMaxFor(metric: TokenMiniSeriesKey): number {
  const floor = metric === 'cost' ? 0.0001 : 1
  return Math.max(...tokenMiniFilteredTimeline.value.map((day) => tokenMiniChartValue(day, metric)), floor)
}

function tokenMiniChartPointsFor(metric: TokenMiniSeriesKey): TokenMiniPoint[] {
  const rows = tokenMiniFilteredTimeline.value
  if (rows.length === 0) return []
  const plotW = TOKEN_MINI_SVG_W.value - TOKEN_MINI_PAD_L.value - TOKEN_MINI_PAD_R.value
  const max = tokenMiniScale.value[metric === 'cost' ? 'cost' : 'tokens'].max || 1
  return rows.map((day, index) => {
    const x = rows.length === 1
      ? TOKEN_MINI_PAD_L.value + plotW / 2
      : TOKEN_MINI_PAD_L.value + (index / (rows.length - 1)) * plotW
    const value = tokenMiniChartValue(day, metric)
    const y = TOKEN_MINI_PAD_T + TOKEN_MINI_PLOT_H.value - (value / max) * TOKEN_MINI_PLOT_H.value
    return { x, y, date: day.date, tokens: day.tokens, cost: day.cost }
  })
}

const tokenMiniTokenChartPoints = computed(() => tokenMiniChartPointsFor('tokens'))
const tokenMiniCostChartPoints = computed(() => tokenMiniChartPointsFor('cost'))

function tokenMiniPointsForMetric(metric: TokenMiniSeriesKey): TokenMiniPoint[] {
  return metric === 'cost' ? tokenMiniCostChartPoints.value : tokenMiniTokenChartPoints.value
}

function tokenMiniColorForMetric(metric: TokenMiniSeriesKey): string {
  return metric === 'cost' ? COST_METRIC_COLOR : TOKEN_METRIC_COLOR
}

function tokenMiniLabelForMetric(metric: TokenMiniSeriesKey): string {
  return metric === 'cost' ? 'API 等价费用' : 'Token'
}

function formatTokenMiniPointValue(metric: TokenMiniSeriesKey, point: TokenMiniPoint): string {
  return metric === 'cost' ? formatTokenMiniChartCost(point.cost) : formatTokenMiniChartToken(point.tokens)
}

const tokenMiniChartPoints = computed(() => tokenMiniPointsForMetric(tokenMiniActiveSeriesKeys.value[0]))

function tokenMiniLinePathFor(points: TokenMiniPoint[]): string {
  if (points.length === 1) {
    const point = points[0]
    const x0 = Math.max(TOKEN_MINI_PAD_L.value, point.x - 8)
    const x1 = Math.min(TOKEN_MINI_SVG_W.value - TOKEN_MINI_PAD_R.value, point.x + 8)
    return `M${x0.toFixed(1)},${point.y.toFixed(1)} L${x1.toFixed(1)},${point.y.toFixed(1)}`
  }
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
}

function tokenMiniAreaPathFor(points: TokenMiniPoint[]): string {
  if (!points.length) return ''
  const bottom = TOKEN_MINI_SVG_H.value - TOKEN_MINI_PAD_B
  if (points.length === 1) {
    const point = points[0]
    const x0 = Math.max(TOKEN_MINI_PAD_L.value, point.x - 7)
    const x1 = Math.min(TOKEN_MINI_SVG_W.value - TOKEN_MINI_PAD_R.value, point.x + 7)
    return `M${x0.toFixed(1)},${bottom} L${x0.toFixed(1)},${point.y.toFixed(1)} L${x1.toFixed(1)},${point.y.toFixed(1)} L${x1.toFixed(1)},${bottom} Z`
  }
  return `${tokenMiniLinePathFor(points)} L${points[points.length - 1].x.toFixed(1)},${bottom} L${points[0].x.toFixed(1)},${bottom} Z`
}

const tokenMiniChartSeries = computed(() => tokenMiniActiveSeriesKeys.value.map((key) => {
  const points = tokenMiniPointsForMetric(key)
  return {
    key,
    label: tokenMiniLabelForMetric(key),
    color: tokenMiniColorForMetric(key),
    points,
    linePath: tokenMiniLinePathFor(points),
    areaPath: tokenMiniAreaPathFor(points),
  }
}))

const tokenMiniPeakMarkers = computed(() => {
  // 数值标签:同时避让"其他标签"与"折线本身",放不下就舍弃(宁缺毋压线)
  type L = { key: TokenMiniSeriesKey; date: string; rank: number; x: number; y: number; labelX: number; labelY: number; color: string; label: string; anchor: string }
  const out: L[] = []
  const seriesList = tokenMiniChartSeries.value
  const W = TOKEN_MINI_SVG_W.value
  const H = TOKEN_MINI_SVG_H.value
  const PL = TOKEN_MINI_PAD_L.value
  const PR = TOKEN_MINI_PAD_R.value
  const padB = TOKEN_MINI_PAD_B
  const LH = 11  // 标签视觉高度

  // 所有折线的点,用于"标签不压线"检测
  const allPts = seriesList.map((sr) => sr.points)
  // 返回 [x0,x1] 范围内所有折线经过的 y 值(端点 + 线段插值采样)
  function lineYsInRange(x0: number, x1: number): number[] {
    const ys: number[] = []
    for (const pts of allPts) {
      for (let i = 0; i < pts.length; i++) {
        const b = pts[i]
        if (b.x >= x0 - 2 && b.x <= x1 + 2) ys.push(b.y)
        if (i > 0) {
          const a = pts[i - 1]
          if (b.x === a.x) continue
          for (const xq of [x0, (x0 + x1) / 2, x1]) {
            if (xq >= Math.min(a.x, b.x) && xq <= Math.max(a.x, b.x)) {
              ys.push(a.y + ((b.y - a.y) * (xq - a.x)) / (b.x - a.x))
            }
          }
        }
      }
    }
    return ys
  }

  const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  function hits(box: { x0: number; y0: number; x1: number; y1: number }): boolean {
    for (const r of placed) {
      if (box.x0 < r.x1 + 3 && box.x1 > r.x0 - 3 && box.y0 < r.y1 + 2 && box.y1 > r.y0 - 2) return true
    }
    for (const ly of lineYsInRange(box.x0, box.x1)) {
      if (ly >= box.y0 - 1.5 && ly <= box.y1 + 1.5) return true
    }
    return false
  }

  seriesList.forEach((series, sIdx) => {
    const pts = series.points
    if (pts.length === 0) return
    const values = pts.map((pp) => (series.key === 'cost' ? pp.cost : pp.tokens))
    const maxIdx = values.indexOf(Math.max(...values))
    const order: number[] = [maxIdx, 0, pts.length - 1]
    for (let k = 1; k < pts.length - 1; k++) if (k !== maxIdx) order.push(k)
    const done = new Set<number>()
    for (const idx of order) {
      if (done.has(idx)) continue
      const pt = pts[idx]
      if (values[idx] <= 0 && idx !== maxIdx) continue
      const label = formatTokenMiniPointValue(series.key, pt)
      const w = label.length * 6.2 + 8
      let anchor = 'middle'
      let cx0 = pt.x - w / 2
      if (pt.x < PL + 14) { anchor = 'start'; cx0 = pt.x - 2 }
      else if (pt.x > W - PR - 14) { anchor = 'end'; cx0 = pt.x - w + 2 }
      const cx1 = cx0 + w
      // 优先放在 token线上方/费用线下方,被占则试另一侧,都不行就舍弃
      const tryYs = sIdx === 0 ? [pt.y - 9, pt.y + 12] : [pt.y + 12, pt.y - 9]
      for (const baseY of tryYs) {
        const labelY = Math.min(H - padB - 1, Math.max(LH, baseY))
        const box = { x0: cx0, y0: labelY - LH, x1: cx1, y1: labelY + 1 }
        if (box.y0 < 1 || box.y1 > H - padB + 1) continue
        if (hits(box)) continue
        placed.push(box)
        done.add(idx)
        out.push({ key: series.key, date: pt.date, rank: idx, x: pt.x, y: pt.y, labelX: pt.x, labelY, color: series.color, label, anchor })
        break
      }
    }
  })
  return out
})
const tokenMiniGridLines = computed(() => {
  const key = tokenMiniActiveSeriesKeys.value[0] || 'tokens'
  const sc = tokenMiniScale.value[key === 'cost' ? 'cost' : 'tokens']
  return sc.ticks.map((v) => TOKEN_MINI_PAD_T + TOKEN_MINI_PLOT_H.value * (1 - (sc.max ? v / sc.max : 0)))
})

// 左轴=主指标整数刻度,右轴=双指标时的费用刻度
const tokenMiniAxisLeft = computed(() => {
  const key = tokenMiniActiveSeriesKeys.value[0]
  if (!key) return []
  const isCost = key === 'cost'
  const sc = tokenMiniScale.value[isCost ? 'cost' : 'tokens']
  return sc.ticks.map((v) => ({
    y: TOKEN_MINI_PAD_T + TOKEN_MINI_PLOT_H.value * (1 - (sc.max ? v / sc.max : 0)),
    text: fmtAxisInt(v, isCost),
  }))
})
const tokenMiniAxisRight = computed(() => {
  if (tokenMiniMetric.value !== 'both') return []
  const tk = tokenMiniScale.value.tokens
  const cs = tokenMiniScale.value.cost
  return tk.ticks.map((v) => {
    const f = tk.max ? v / tk.max : 0
    return { y: TOKEN_MINI_PAD_T + TOKEN_MINI_PLOT_H.value * (1 - f), text: fmtAxisInt(cs.max * f, true) }
  })
})

// 横轴日期刻度:按可用宽度尽量多放,首尾必有
const tokenMiniDateTicks = computed(() => {
  const pts = tokenMiniChartPoints.value
  if (pts.length === 0) return []
  if (pts.length === 1) {
    return [{
      x: pts[0].x,
      label: formatShortDate(pts[0].date),
      anchor: 'middle',
    }]
  }
  const plotW = TOKEN_MINI_SVG_W.value - TOKEN_MINI_PAD_L.value - TOKEN_MINI_PAD_R.value
  const maxTicks = Math.max(2, Math.floor(plotW / 56) + 1)
  const count = Math.min(pts.length, maxTicks)
  const idxs = new Set<number>()
  for (let k = 0; k < count; k++) idxs.add(Math.round((k * (pts.length - 1)) / (count - 1)))
  return [...idxs].sort((a, b) => a - b).map((i2) => ({
    x: pts[i2].x,
    label: formatShortDate(pts[i2].date),
    anchor: i2 === 0 ? 'start' : i2 === pts.length - 1 ? 'end' : 'middle',
  }))
})

const tokenMiniHoverPoint = computed(() => {
  const index = tokenMiniHoverIndex.value
  if (index === null) return null
  return tokenMiniChartPoints.value[index] || null
})
const tokenMiniHoverSeriesPoints = computed(() => {
  const index = tokenMiniHoverIndex.value
  if (index === null) return []
  return tokenMiniChartSeries.value
    .map((series) => {
      const point = series.points[index]
      return point ? { key: series.key, color: series.color, point } : null
    })
    .filter((item): item is { key: TokenMiniSeriesKey; color: string; point: TokenMiniPoint } => Boolean(item))
})
const tokenMiniHoverRows = computed(() => {
  return tokenMiniHoverSeriesPoints.value.map((item) => ({
    key: item.key,
    label: tokenMiniLabelForMetric(item.key),
    value: formatTokenMiniPointValue(item.key, item.point),
    color: item.color,
  }))
})
const tokenMiniTooltipStyle = computed(() => {
  const point = tokenMiniHoverPoint.value
  if (!point) return {}
  const left = Math.min(88, Math.max(12, (point.x / TOKEN_MINI_SVG_W.value) * 100))
  const top = Math.min(78, Math.max(18, (point.y / TOKEN_MINI_SVG_H.value) * 100))
  return {
    left: `${left}%`,
    top: `${top}%`,
  }
})

function handleTokenMiniChartMove(event: MouseEvent): void {
  const points = tokenMiniChartPoints.value
  if (points.length === 0) {
    tokenMiniHoverIndex.value = null
    return
  }
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
  const svgX = (relativeX / Math.max(rect.width, 1)) * TOKEN_MINI_SVG_W.value
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  points.forEach((point, index) => {
    const distance = Math.abs(point.x - svgX)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })
  tokenMiniHoverIndex.value = nearestIndex
}

function clearTokenMiniHover(): void {
  tokenMiniHoverIndex.value = null
}

const scopedUsageTotals = computed<UsageDatum>(() => {
  if (!tokenUsageSnapshotReady.value) return emptyUsage()
  if (tokenMiniRangeTimeline.value.length > 0 || tokenUsageSnapshotRange.value !== 'all') {
    return tokenMiniTotals.value
  }

  if (hasTokenMiniModelFilter.value) {
    const byModel = store.globalUsage.byModel || {}
    const fallback: UsageDatum = emptyUsage()
    for (const [model, usage] of Object.entries(byModel)) {
      if (isTokenMiniModelActive(model)) addUsage(fallback, usage)
    }
    if (fallback.tokens <= 0 && fallback.cost <= 0) {
      for (const modelMap of Object.values(store.globalUsage.byAgentByModel || {})) {
        for (const [model, usage] of Object.entries(modelMap || {})) {
          if (isTokenMiniModelActive(model)) addUsage(fallback, usage)
        }
      }
    }
    if (fallback.tokens > 0 || fallback.cost > 0) return fallback
    return fallback
  }

  return {
    tokens: store.totalTokensUsed || 0,
    cost: store.totalCostCny || 0,
    input: store.globalUsage.totalInputTokens || 0,
    output: store.globalUsage.totalOutputTokens || 0,
    cacheRead: store.globalUsage.totalCacheReadTokens || 0,
    cacheWrite: store.globalUsage.totalCacheWriteTokens || 0,
  }
})

const scopedCostText = computed(() => formatCostScope(scopedUsageTotals.value.cost, scopedUsageTotals.value.priceStatus, scopedUsageTotals.value.billingMode))
const scopedUsdText = computed(() => formatUsdScope(scopedUsageTotals.value.cost, scopedUsageTotals.value.priceStatus))
const scopedTokenText = computed(() => formatTokenZh(scopedUsageTotals.value.tokens))
const summaryUsageTotals = computed<UsageDatum>(() => summaryUsageTimeline.value.reduce(
  (sum, day) => {
    addUsage(sum, day)
    return sum
  },
  emptyUsage(),
))
const summaryUsageRangeLabel = computed(() => {
  const range = summaryUsageReady.value ? summaryUsagePublishedRange.value : summaryUsageRange.value
  return SUMMARY_USAGE_RANGES.find((option) => option.value === range)?.label || '本月'
})
const summaryUsageTokenText = computed(() => formatTokenZh(summaryUsageTotals.value.tokens))
const summaryUsageCostText = computed(() => formatCostScope(
  summaryUsageTotals.value.cost,
  summaryUsageTotals.value.priceStatus,
  summaryUsageTotals.value.billingMode,
))

const scopedAgentUsageMap = computed<Record<string, UsageDatum>>(() => {
  const out: Record<string, UsageDatum> = createSafeRecord()
  const ensureAgent = (agentId: string): UsageDatum => {
    if (!Object.hasOwn(out, agentId)) out[agentId] = emptyUsage()
    return out[agentId]
  }

  for (const day of tokenMiniRangeTimeline.value) {
    for (const [agentId, byModel] of Object.entries(day.byAgentByModel || {})) {
      for (const [model, usage] of Object.entries(byModel || {})) {
        if (!isTokenMiniModelActive(model)) continue
        addUsage(ensureAgent(agentId), usage)
      }
    }
  }

  if (Object.keys(out).length === 0 && tokenUsageSnapshotRange.value === 'all') {
    const byAgentByModel = store.globalUsage.byAgentByModel || {}
    let hasModelBreakdown = false
    for (const [agentId, byModel] of Object.entries(byAgentByModel)) {
      for (const [model, usage] of Object.entries(byModel || {})) {
        if (!isTokenMiniModelActive(model)) continue
        hasModelBreakdown = true
        addUsage(ensureAgent(agentId), usage)
      }
    }

    if (!hasTokenMiniModelFilter.value && !hasModelBreakdown) {
      for (const [agentId, usage] of Object.entries(store.globalUsage.byAgent || {})) {
        addUsage(ensureAgent(agentId), usage)
      }
    }
  }

  return out
})

function getAgentScopedUsage(agent: AgentInfo): UsageDatum {
  const id = getAgentId(agent)
  return ownValue(scopedAgentUsageMap.value, id) || emptyUsage()
}

function hasScopedUsageActivity(usage: UsageDatum): boolean {
  return Number(usage.tokens) > 0
    || Number(usage.cost) > 0
    || Number(usage.input) > 0
    || Number(usage.output) > 0
    || Number(usage.cacheRead) > 0
    || Number(usage.cacheWrite) > 0
}

function usageMetricText(usage: UsageDatum): string {
  if (tokenMiniMetric.value === 'cost') return formatCostScope(usage.cost, usage.priceStatus, usage.billingMode)
  const value = usageMetricValue(usage)
  if (value <= 0) return '0'
  return formatUsageByMetric(usage)
}

const agentPulseRows = computed<PulseRow[]>(() => {
  return [...store.agents]
    .filter((agent) => hasScopedUsageActivity(getAgentScopedUsage(agent)))
    .map((agent) => {
      const usage = getAgentScopedUsage(agent)
      const usageValue = usageMetricValue(usage)
      return {
        key: agent.key,
        kind: 'openclaw' as PulseAppId,
        agent,
        projectScope: undefined as ProjectTokenScope | undefined,
        name: getAgentDisplayName(agent),
        avatarSrc: getAgentAvatarSrc(agent),
        avatarText: 'OC',
        statusLabel: getAgentStatusLabel(agent),
        statusClass: getAgentStatusClass(agent),
        lastActivityMs: agent.lastActivity,
        usage,
        usageValue,
        tokenText: formatTokenZh(usage.tokens),
        costText: formatCostScope(usage.cost, usage.priceStatus, usage.billingMode),
        metricText: usageMetricText(usage),
      }
    })
    .sort((a, b) => {
      const rank = (row: typeof a) => {
        if (row.agent.status === 'running') return 0
        if (isRecentlyActive(row.agent)) return 1
        if (row.agent.status === 'error') return 2
        if (row.agent.status === 'aborted') return 3
        return 4
      }
      return rank(a) - rank(b) || b.usageValue - a.usageValue || a.name.localeCompare(b.name, 'zh-CN')
    })
})

const localAiUsageAppMap = computed(() => {
  const map = new Map<PulseAppId, LocalAiUsageApp>()
  for (const app of localAiUsageApps.value) map.set(app.id, app)
  return map
})

function getLocalUsageStatusLabel(item: LocalAiUsageItem): string {
  const last = Number(item.lastActivityMs) || (item.updatedAt ? Date.parse(item.updatedAt) : 0)
  if (!last) return '无记录'
  return '没干活'
}

function getPulseAvatarText(appId: PulseAppId): string {
  if (appId === 'codex') return 'Cx'
  if (appId === 'claude-code') return 'Cl'
  if (appId === 'openclaw') return 'OC'
  return appId.slice(0, 2).toUpperCase()
}

function getLocalPulseAvatarSrc(appId: PulseAppId): string {
  if (appId === 'codex') return '/app-logos/chatgpt-white-black.svg'
  if (appId === 'claude-code') return '/app-logos/claude-app-orange.png'
  return aiToolRegistry.get(appId)?.iconSrc || '/avatars/default.svg'
}

function localProjectFolderName(value?: string): string {
  return projectFolderName(value)
}

function normalizeLocalProjectPath(value?: string): string {
  return normalizeProjectPath(value)
}

function localAppRows(app: LocalAiUsageApp | undefined, appId: PulseAppId): PulseRow[] {
  type ProjectStatusSnapshot = {
    status: UnifiedStatus
    label: string
    reason: string
    lastActivityMs: number
  }

  const groups = new Map<string, { project: string; items: LocalAiUsageItem[] }>()
  for (const item of app?.items || []) {
    const project = normalizeLocalProjectPath(item.project)
    const groupKey = project || '__conversation__'
    const group = groups.get(groupKey) || { project, items: [] }
    group.items.push(item)
    groups.set(groupKey, group)
  }

  return [...groups.entries()].map(([groupKey, group]) => {
    const usage = emptyUsage()
    const projectSources = new Map<string, {
      id: string
      sessionId: string
      name: string
      lastActivityMs: number
      status: UnifiedStatus
      label: string
    }>()
    let latestStatus: ProjectStatusSnapshot | null = null
    let runningStatus: ProjectStatusSnapshot | null = null
    let lastActivityMs = 0

    for (const item of group.items) {
      const sourceId = localUsageSourceId(appId, item.id)
      const scopedUsage = scopedAgentUsageMap.value[sourceId]
      addUsage(usage, scopedUsage || item.usage)

      const liveStatus = findLocalAiStatus(item)
      const fallbackStatus = fallbackLocalStatus(item)
      const itemStatus = {
        status: liveStatus?.status || fallbackStatus.status,
        label: liveStatus?.label || fallbackStatus.label,
        reason: liveStatus?.reason || '',
        lastActivityMs: Number(liveStatus?.lastActivityMs || fallbackStatus.lastActivityMs) || 0,
      }
      projectSources.set(sourceId, {
        id: sourceId,
        sessionId: String(item.id || '').trim(),
        name: String(item.name || '').trim() || '未命名对话',
        lastActivityMs: itemStatus.lastActivityMs,
        status: itemStatus.status,
        label: itemStatus.label,
      })
      lastActivityMs = Math.max(lastActivityMs, itemStatus.lastActivityMs)
      if (!latestStatus || itemStatus.lastActivityMs > latestStatus.lastActivityMs) latestStatus = itemStatus
      if (itemStatus.status === 'running' && (!runningStatus || itemStatus.lastActivityMs > runningStatus.lastActivityMs)) {
        runningStatus = itemStatus
      }
    }

    const selectedStatus = runningStatus || latestStatus || {
      status: 'idle' as UnifiedStatus,
      label: '没干活',
      reason: '',
      lastActivityMs: 0,
    }
    const usageValue = usageMetricValue(usage)
    const status = selectedStatus.status
    const statusLabel = status === 'running' ? '正在干活' : selectedStatus.label
    const projectScope = createProjectTokenScope({
      appId,
      appName: app?.name || (appId === 'codex' ? 'Codex' : 'Claude Code'),
      projectPath: group.project,
      sources: [...projectSources.values()],
    }) as ProjectTokenScope
    return {
      key: `local-project:${appId}:${groupKey}`,
      kind: appId,
      name: localProjectFolderName(group.project),
      project: group.project,
      projectScope,
      avatarSrc: getLocalPulseAvatarSrc(appId),
      avatarText: getPulseAvatarText(appId),
      statusLabel,
      statusClass: localStatusClass(status, statusLabel),
      status,
      statusReason: selectedStatus.reason,
      lastActivityMs,
      usage,
      usageValue,
      tokenText: formatTokenZh(usage.tokens),
      costText: formatCostScope(usage.cost, usage.priceStatus, usage.billingMode),
      metricText: usageMetricText(usage),
    }
  }).sort((a, b) => b.usageValue - a.usageValue || a.name.localeCompare(b.name, 'zh-CN'))
}

function sumPulseRows(rows: PulseRow[]): UsageDatum {
  return rows.reduce((sum, row) => {
    addUsage(sum, row.usage)
    return sum
  }, emptyUsage())
}

function makePulseApp(tool: AiToolDescriptor, rows: PulseRow[], usage: UsageDatum, headline?: string): PulseApp {
  return {
    id: tool.id,
    name: tool.name,
    iconSrc: tool.iconSrc,
    headline: headline || `${rows.length} 个${tool.objectLabel}`,
    countText: `${rows.length} 个${tool.objectLabel}`,
    metricText: usageMetricText(usage),
    usage,
    rows,
  }
}

const pulseApps = computed<PulseApp[]>(() => {
  for (const app of localAiUsageApps.value) {
    if (aiToolRegistry.has(app.id)) continue
    aiToolRegistry.register({
      id: app.id,
      name: app.name || app.id,
      iconSrc: '/avatars/default.svg',
      objectLabel: app.itemLabel || '对象',
      capabilities: {
        monitor: true,
        usage: true,
        details: true,
        sessions: true,
      },
    })
  }

  return aiToolRegistry.list()
    .filter((tool) => tool.capabilities.monitor)
    .map((tool) => {
      const rows = tool.id === 'openclaw'
        ? agentPulseRows.value
        : localAppRows(localAiUsageAppMap.value.get(tool.id), tool.id)
      const headline = tool.id === 'openclaw'
        ? `${rows.filter((row) => row.agent?.status === 'running').length} 个正在干活`
        : undefined
      return makePulseApp(tool, rows, sumPulseRows(rows), headline)
    })
})

const aiToolDescriptors = computed(() => {
  void pulseApps.value
  return aiToolRegistry.list()
})

const selectedPulseApp = computed(() => (
  pulseApps.value.find((app) => app.id === selectedPulseAppId.value) || pulseApps.value[0]
))

function isPulseRowInStatus(row: PulseRow, status: PulseStatusFilter): boolean {
  if (status === 'all') return true
  return getMonitorStatus(row) === status
}

const selectedPulseRows = computed(() => {
  const rows = selectedPulseApp.value?.rows || []
  return rows.filter((row) => isPulseRowInStatus(row, pulseStatusFilter.value))
})
const pulseStatusFilterLabel = computed(() => {
  const labels: Record<PulseStatusFilter, string> = {
    all: '全部对象',
    running: '运行中对象',
    idle: '空闲对象',
    aborted: '已终止对象',
    error: '错误对象',
  }
  return labels[pulseStatusFilter.value]
})
const showPulseStatusFilter = computed(() => pulseStatusFilter.value !== 'all')
const selectedPulseUsage = computed(() => sumPulseRows(selectedPulseRows.value))
const selectedPulseHeadline = computed(() => (
  showPulseStatusFilter.value
    ? `${selectedPulseRows.value.length} 个${pulseStatusFilterLabel.value}`
    : selectedPulseApp.value?.headline || '暂无数据'
))
const selectedPulseCountText = computed(() => (
  showPulseStatusFilter.value
    ? `${selectedPulseRows.value.length} 个结果`
    : selectedPulseApp.value?.countText || '0 个对象'
))
const selectedPulseMetricText = computed(() => (
  showPulseStatusFilter.value
    ? usageMetricText(selectedPulseUsage.value)
    : selectedPulseApp.value?.metricText || '0'
))
const selectedPulseEmptyText = computed(() => {
  if (localAiUsageLoading.value && selectedPulseAppId.value !== 'openclaw') return '正在读取本地记录…'
  if (showPulseStatusFilter.value) return `暂无${pulseStatusFilterLabel.value}`
  return selectedPulseAppId.value === 'openclaw' ? '暂无 OpenClaw Agent' : '暂无本地记录'
})

const DEFAULT_MONITOR_SOURCE_IDS: PulseAppId[] = DEFAULT_AI_TOOLS.map((tool) => tool.id)
const MONITOR_OBJECT_SETTINGS_KEY = 'openclaw_dashboard_monitor_objects_v1'

const monitorStatusTabs: Array<{ value: MonitorStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'idle', label: '空闲' },
  { value: 'aborted', label: '已终止' },
  { value: 'error', label: '错误' },
]
const monitorBoardColumns: Array<{
  status: MonitorObjectStatus
  label: string
  color: string
  emptyText: string
}> = [
  { status: 'idle', label: '空闲', color: '#ff9f0a', emptyText: '暂无空闲对象' },
  { status: 'running', label: '运行中', color: '#0a84ff', emptyText: '暂无运行中对象' },
  { status: 'aborted', label: '已终止', color: '#8e8e93', emptyText: '暂无已终止对象' },
  { status: 'error', label: '错误', color: '#ff453a', emptyText: '暂无错误对象' },
]

function normalizeMonitorSources(raw: unknown): PulseAppId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_MONITOR_SOURCE_IDS]
  return raw.filter((id): id is PulseAppId => typeof id === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(id))
}

function loadMonitorObjectSettings(): void {
  try {
    const raw = localStorage.getItem(MONITOR_OBJECT_SETTINGS_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as { sources?: unknown; hiddenKeys?: unknown }
    monitorSourceFilter.value = normalizeMonitorSources(data.sources)
    monitorHiddenKeys.value = Array.isArray(data.hiddenKeys)
      ? data.hiddenKeys.filter((key): key is string => typeof key === 'string')
      : []
  } catch {
    monitorSourceFilter.value = [...DEFAULT_MONITOR_SOURCE_IDS]
    monitorHiddenKeys.value = []
  }
}

function saveMonitorObjectSettings(): void {
  try {
    localStorage.setItem(MONITOR_OBJECT_SETTINGS_KEY, JSON.stringify({
      sources: monitorSourceFilter.value,
      hiddenKeys: monitorHiddenKeys.value,
    }))
  } catch {
    // 本地偏好保存失败不影响面板使用。
  }
}

loadMonitorObjectSettings()

watch([monitorSourceFilter, monitorHiddenKeys], saveMonitorObjectSettings, { deep: true })

function monitorRowKey(row: PulseRow): string {
  return `${row.kind}:${row.key}`
}

function getMonitorStatus(row: PulseRow): MonitorObjectStatus {
  if (row.kind === 'openclaw' && row.agent) {
    if (row.agent.status === 'running' || row.agent.status === 'idle' || row.agent.status === 'aborted' || row.agent.status === 'error') {
      return row.agent.status
    }
  }
  if (row.status === 'running' || row.status === 'idle' || row.status === 'aborted' || row.status === 'error') {
    return row.status
  }
  return 'idle'
}

function getMonitorLastActivityText(row: PulseRow): string {
  const ms = Number(row.lastActivityMs) || 0
  if (ms > 0) return `最近 ${formatNotifTime(ms)}`
  return row.kind === 'openclaw' ? '暂无活动时间' : row.statusLabel
}

const monitorAllRows = computed<MonitorObjectRow[]>(() => {
  const hidden = new Set(monitorHiddenKeys.value)
  return pulseApps.value.flatMap((app) => app.rows.map((row) => {
    const monitorKey = monitorRowKey(row)
    return {
      ...row,
      monitorKey,
      sourceName: app.name,
      sourceIconSrc: app.iconSrc,
      monitorStatus: getMonitorStatus(row),
      lastActivityText: getMonitorLastActivityText(row),
      hidden: hidden.has(monitorKey),
    }
  }))
})

const monitorTotalObjectCount = computed(() => monitorAllRows.value.length)
const selectedMonitorDetailObject = computed(() => {
  const row = selectedMonitorObject.value
  if (!row) return null
  return {
    name: row.name,
    sourceName: row.sourceName,
    sourceIconSrc: row.sourceIconSrc,
    avatarSrc: row.avatarSrc,
    monitorStatus: row.monitorStatus,
    statusLabel: row.statusLabel,
    lastActivityText: row.lastActivityText,
    project: row.project,
    tokenText: row.tokenText,
    costText: row.costText,
    hasSpecializedDetail: Boolean(row.agent),
  }
})

function monitorBoardRows(status: MonitorObjectStatus): MonitorObjectRow[] {
  return monitorAllRows.value
    .filter((row) => !row.hidden && row.monitorStatus === status)
    .sort((a, b) => b.usageValue - a.usageValue || a.name.localeCompare(b.name, 'zh-CN'))
}

const monitorSourceOptions = computed(() => pulseApps.value.map((app) => ({
  id: app.id,
  name: app.name,
  iconSrc: app.iconSrc,
  countText: app.countText,
  metricText: app.metricText,
})))

const monitorRowsBySource = computed(() => {
  const sources = new Set(monitorSourceFilter.value)
  return monitorAllRows.value.filter((row) => sources.has(row.kind))
})

function isMonitorRowInStatus(row: MonitorObjectRow, status: MonitorStatusFilter): boolean {
  if (status === 'all') return true
  return row.monitorStatus === status
}

const monitorRowsByStatus = computed(() => (
  monitorRowsBySource.value.filter((row) => isMonitorRowInStatus(row, monitorDetailStatus.value))
))

const monitorDetailRows = computed(() => (
  monitorRowsByStatus.value
    .filter((row) => monitorShowHidden.value ? row.hidden : !row.hidden)
    .sort((a, b) => b.usageValue - a.usageValue || a.name.localeCompare(b.name, 'zh-CN'))
))

const monitorVisibleRowCount = computed(() => monitorDetailRows.value.length)

function monitorStatusCount(status: MonitorStatusFilter): number {
  return monitorAllRows.value.filter((row) => isMonitorRowInStatus(row, status)).length
}

function toggleMonitorSource(id: PulseAppId): void {
  const current = new Set(monitorSourceFilter.value)
  if (current.has(id)) current.delete(id)
  else current.add(id)
  monitorSourceFilter.value = pulseApps.value.map((app) => app.id).filter((sourceId) => current.has(sourceId))
}

function showAllMonitorSources(): void {
  monitorSourceFilter.value = pulseApps.value.map((app) => app.id)
}

function openMonitorObjectsDialog(status: MonitorStatusFilter): void {
  monitorDetailStatus.value = status
  monitorShowHidden.value = false
  monitorObjectsDialogVisible.value = true
}

function hideMonitorObject(key: string): void {
  if (monitorHiddenKeys.value.includes(key)) return
  monitorHiddenKeys.value = [...monitorHiddenKeys.value, key]
}

function restoreMonitorObject(key: string): void {
  monitorHiddenKeys.value = monitorHiddenKeys.value.filter((item) => item !== key)
}

function resetMonitorHiddenObjects(): void {
  monitorHiddenKeys.value = []
}

function openMonitorObject(row: MonitorObjectRow): void {
  monitorObjectsDialogVisible.value = false
  selectedMonitorObject.value = row
  monitorObjectDetailVisible.value = true
}

function openMonitorObjectByKey(key: string): void {
  const row = monitorAllRows.value.find(item => item.monitorKey === key)
  if (row) openMonitorObject(row)
}

function openSelectedMonitorExecution(): void {
  const row = selectedMonitorObject.value
  if (!row) return
  monitorObjectDetailVisible.value = false
  if (row.agent) {
    const agentId = String(row.agent.key || '').split(':')[1] || String(row.agent.name || '')
    if (!agentId) {
      ElMessage.warning('当前对象没有可识别的会话范围')
      return
    }
    openExecutionScope({
      source: row.kind,
      displayName: `${row.sourceName} · ${row.name}`,
      agentId,
      sessionIds: [],
    })
    return
  }
  if (row.projectScope) openProjectExecution(row.projectScope)
  else ElMessage.warning('当前对象没有可识别的会话范围')
}

function openSelectedMonitorUsage(): void {
  const row = selectedMonitorObject.value
  if (!row) return
  monitorObjectDetailVisible.value = false
  openTokenDetail(null, row.projectScope || null)
}

function openSelectedMonitorSpecialized(): void {
  const row = selectedMonitorObject.value
  if (!row?.agent) return
  monitorObjectDetailVisible.value = false
  onAgentDetail(row.agent)
}

function scrollToElement(el: HTMLElement | null): void {
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function focusPulseApp(appId: PulseAppId, status: PulseStatusFilter = 'all'): Promise<void> {
  selectedPulseAppId.value = appId
  pulseStatusFilter.value = status
  await nextTick()
  scrollToElement(agentPulseCardEl.value)
}

function selectPulseApp(appId: PulseAppId): void {
  void focusPulseApp(appId, 'all')
}

function clearPulseStatusFilter(): void {
  pulseStatusFilter.value = 'all'
}

function onPulseRowClick(row: PulseRow): void {
  const monitorRow = monitorAllRows.value.find(item => item.monitorKey === monitorRowKey(row))
  if (monitorRow) openMonitorObject(monitorRow)
  else openTokenDetail(null, row.projectScope || null)
}

function onContributionRowClick(row: { kind: PulseAppId; key: string; agent?: AgentInfo; projectScope?: ProjectTokenScope }): void {
  if (row.kind === 'openclaw' && row.agent) onAgentDetail(row.agent)
  else openTokenDetail(null, row.projectScope || null)
}

const contributionRows = computed(() => {
  const openclawRows = [...store.agents]
    .map((agent) => {
      const usage = getAgentScopedUsage(agent)
      const usageValue = usageMetricValue(usage)
      return {
        key: `openclaw:${agent.key}`,
        kind: 'openclaw' as PulseAppId,
        agent,
        projectScope: undefined as ProjectTokenScope | undefined,
        name: getAgentDisplayName(agent),
        project: '',
        avatarSrc: getAgentAvatarSrc(agent),
        usage,
        usageValue,
        tokenText: formatTokenZh(usage.tokens),
        costText: formatCostScope(usage.cost, usage.priceStatus, usage.billingMode),
        metricText: formatUsageByMetric(usage),
      }
    })
  const localRows = pulseApps.value
    .filter((app) => app.id !== 'openclaw')
    .flatMap((app) => app.rows.map((row) => ({
      key: row.key,
      kind: row.kind,
      agent: undefined,
      name: row.name,
      project: row.project || '',
      projectScope: row.projectScope,
      avatarSrc: row.avatarSrc,
      usage: row.usage,
      usageValue: row.usageValue,
      tokenText: row.tokenText,
      costText: row.costText,
      metricText: row.metricText,
    })))

  return [...openclawRows, ...localRows]
    .filter((row) => row.usage.tokens > 0 || row.usage.cost > 0)
    .sort((a, b) => b.usageValue - a.usageValue || a.name.localeCompare(b.name, 'zh-CN'))
})

const CONTRIBUTION_COLLAPSED_COUNT = 7
const CONTRIBUTION_EXPANDED_VISIBLE_COUNT = CONTRIBUTION_COLLAPSED_COUNT + 4
const contributionExpanded = ref(false)
const visibleContributionRows = computed(() => (
  contributionExpanded.value
    ? contributionRows.value
    : contributionRows.value.slice(0, CONTRIBUTION_COLLAPSED_COUNT)
))
const contributionHiddenCount = computed(() => Math.max(
  0,
  contributionRows.value.length - (contributionExpanded.value ? contributionRows.value.length : CONTRIBUTION_COLLAPSED_COUNT),
))
const contributionExpandedVisibleCount = computed(() => Math.min(
  contributionRows.value.length,
  CONTRIBUTION_EXPANDED_VISIBLE_COUNT,
))

function contributionWidth(value: number): string {
  const max = contributionRows.value[0]?.usageValue || 1
  if (value <= 0) return '0%'
  return `${Math.max(8, Math.round((value / max) * 100))}%`
}
const contributionMaxTokens = computed(() => Math.max(1, ...contributionRows.value.map((r) => r.usage.tokens || 0)))
const contributionMaxCost = computed(() => Math.max(0.0001, ...contributionRows.value.map((r) => r.usage.cost || 0)))
function barW(value: number, max: number): string {
  if (value <= 0) return '0%'
  return `${Math.max(6, Math.round((value / max) * 100))}%`
}

const modelShareRows = computed(() => {
  const byModel = tokenMiniRangeByModel.value
  const metric: TokenMiniSeriesKey = tokenMiniMetric.value === 'cost' ? 'cost' : 'tokens'
  const total = Object.values(byModel).reduce((sum, row) => sum + (Number(row[metric]) || 0), 0) || 1
  return Object.entries(byModel)
    .filter(([, data]) => (Number(data.tokens) || 0) > 0 || (Number(data.cost) || 0) > 0)
    .sort((a, b) => (Number(b[1][metric]) || 0) - (Number(a[1][metric]) || 0))
    .map(([model, data], index) => ({
      model,
      label: getModelDisplayLabel(model),
      tokenText: formatTokenZh(data.tokens),
      costText: formatCostScope(data.cost, data.priceStatus, data.billingMode),
      metricText: metric === 'cost' ? formatCostScope(data.cost, data.priceStatus, data.billingMode) : formatTokenZh(data.tokens),
      pct: Math.round(((Number(data[metric]) || 0) / total) * 100),
      color: getModelColor(model, index),
    }))
})

const MODEL_SHARE_COLLAPSED_COUNT = 3
const MODEL_SHARE_EXPANDED_VISIBLE_COUNT = MODEL_SHARE_COLLAPSED_COUNT + 4
const modelShareExpanded = ref(false)
const visibleModelShareRows = computed(() => (
  modelShareExpanded.value
    ? modelShareRows.value
    : modelShareRows.value.slice(0, MODEL_SHARE_COLLAPSED_COUNT)
))
const modelShareHiddenCount = computed(() => Math.max(
  0,
  modelShareRows.value.length - (modelShareExpanded.value ? modelShareRows.value.length : MODEL_SHARE_COLLAPSED_COUNT),
))
const modelShareExpandedVisibleCount = computed(() => Math.min(
  modelShareRows.value.length,
  MODEL_SHARE_EXPANDED_VISIBLE_COUNT,
))

function setOverviewListsExpanded(expanded: boolean): void {
  modelShareExpanded.value = expanded
  contributionExpanded.value = expanded
}

// REC-011: 加载超时提示（加载超过 10s 时显示）
const loadingHintVisible = ref(false)
let loadingHintTimer: ReturnType<typeof setTimeout> | null = null
let loadingCheckTimer: ReturnType<typeof setInterval> | null = null

function checkLoadingHint(): void {
  // 只在"首次加载尚未完成"时（lastUpdateTime 仍为 0）才显示提示
  // isPolling 表示轮询循环在运行，不代表正在加载
  const initialLoadPending = store.isPolling && store.lastUpdateTime === 0
  if (initialLoadPending) {
    if (!loadingHintVisible.value && !loadingHintTimer) {
      loadingHintTimer = setTimeout(() => {
        loadingHintVisible.value = true
        loadingHintTimer = null
      }, 10000)
    }
  } else {
    if (loadingHintTimer) {
      clearTimeout(loadingHintTimer)
      loadingHintTimer = null
    }
    loadingHintVisible.value = false
  }
}

/** 通过同源服务端代理打开 OpenClaw WebUI，浏览器 URL 不携带凭据。 */
function openWebUI(): void {
  window.open('/gateway-api/', '_blank', 'noopener,noreferrer')
}

function openToolManagement(action: AiToolManagementActionId | null = null): void {
  toolManagementFocus.value = action
  toolManagementVisible.value = true
}

function handleToolManagementAction(toolId: string, action: AiToolManagementActionId): void {
  toolManagementVisible.value = false
  switch (action) {
    case 'monitor':
      monitorSourceFilter.value = [toolId]
      openMonitorObjectsDialog('all')
      break
    case 'usage':
      openTokenDetail(toolId)
      break
    case 'sessions':
    case 'timeline':
      activityTimelineVisible.value = true
      break
    case 'files':
      fileManagerVisible.value = true
      break
    case 'tasks':
      projectBoardVisible.value = true
      break
    case 'automation':
      cronCenterVisible.value = true
      break
    case 'messages':
      window.dispatchEvent(new CustomEvent('ai-workbench:open-quick-message', { detail: { toolId } }))
      break
    case 'skills':
      skillsDialogVisible.value = true
      break
    case 'version':
      versionDialogVisible.value = true
      break
    case 'nativeUi':
      if (toolId === 'openclaw') openWebUI()
      break
    case 'search':
      commandPaletteVisible.value = true
      break
  }
}

// Stats cards（每张卡片带 id，便于自定义排序）
const statsCardsRaw = computed(() => [
  {
    id: 'total',
    label: '总计',
    value: tokenUsageSnapshotReady.value ? monitorTotalObjectCount.value : '…',
    icon: Odometer,
    iconClass: 'icon-blue',
    class: 'stat-total',
    onClick: () => openMonitorObjectsDialog('all'),
  },
  {
    id: 'running',
    label: '运行中',
    value: tokenUsageSnapshotReady.value ? monitorStatusCount('running') : '…',
    icon: VideoPlay,
    iconClass: 'icon-yellow',
    class: 'stat-running',
    onClick: () => openMonitorObjectsDialog('running'),
  },
  {
    id: 'idle',
    label: '空闲',
    value: tokenUsageSnapshotReady.value ? monitorStatusCount('idle') : '…',
    icon: VideoPause,
    iconClass: 'icon-green',
    class: 'stat-idle',
    onClick: () => openMonitorObjectsDialog('idle'),
  },
  {
    id: 'aborted',
    label: '已终止',
    value: tokenUsageSnapshotReady.value ? monitorStatusCount('aborted') : '…',
    icon: CircleClose,
    iconClass: 'icon-gray',
    class: 'stat-aborted',
    onClick: () => openMonitorObjectsDialog('aborted'),
  },
  {
    id: 'error',
    label: '错误',
    value: tokenUsageSnapshotReady.value ? monitorStatusCount('error') : '…',
    icon: CircleClose,
    iconClass: 'icon-red',
    class: 'stat-error',
    onClick: () => openMonitorObjectsDialog('error'),
  },
  {
    id: 'uptime',
    label: '本次运行时间',
    value: store.formatUptime(store.uptimeMs),
    icon: Monitor,
    iconClass: 'icon-purple',
    class: 'stat-uptime',
  },
  {
    id: 'tokens',
    label: `${summaryUsageRangeLabel.value} Token`,
    value: summaryUsageReady.value ? summaryUsageTokenText.value : '汇总中',
    title: summaryUsageLoading.value ? '摘要正在更新' : '点击修改摘要时间范围',
    icon: Odometer, iconClass: 'icon-orange', class: 'stat-tokens stat-clickable',
    onClick: () => { summaryUsageDialogVisible.value = true },
  },
  {
    id: 'cost',
    label: `${summaryUsageRangeLabel.value}费用`,
    value: summaryUsageReady.value ? summaryUsageCostText.value : '汇总中',
    title: summaryUsageLoading.value ? '摘要正在更新' : '点击修改摘要时间范围',
    icon: Money, iconClass: 'icon-green', class: 'stat-cost stat-clickable',
    onClick: () => { summaryUsageDialogVisible.value = true },
  },
])

// 按用户自定义顺序重排
const statsCards = computed(() => {
  const order = layoutConfig.value.statsCards
  const map = new Map(statsCardsRaw.value.map(c => [c.id, c]))
  return order.map(id => map.get(id)).filter(Boolean) as typeof statsCardsRaw.value
})

// Health
const healthDisplay = computed(() => {
  switch (store.healthStatus) {
    case 'healthy': return '正常'
    case 'degraded': return '降级'
    case 'unhealthy': return '异常'
    case 'unknown': return '未知'
    default: return '检查中...'
  }
})
const healthIcon = computed(() => {
  if (store.healthStatus === 'healthy') return CircleCheck
  if (store.healthStatus === 'degraded') return Warning
  return Warning
})

// Actions
const drawerAutoFocusInput = ref(false)
function onAgentDetail(agent: AgentInfo, opts?: { focusInput?: boolean }): void {
  pendingAgentExecutionScope.value = null
  selectedAgent.value = agent
  drawerAutoFocusInput.value = !!opts?.focusInput
  drawerVisible.value = true
}

function formatNotifTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function refreshAll(): Promise<void> {
  await Promise.all([store.fetchAgents(), store.fetchHealth()])
}

async function handleBillingSaved(): Promise<void> {
  await Promise.all([
    store.fetchGlobalUsage(),
    store.fetchCostSummary(),
    refreshTokenUsageSnapshot({ blocking: true }),
    refreshSummaryUsage(),
    fetchLocalAiStatus(),
  ])
  void prewarmTokenUsageRanges()
}

// Sprint 7: cmd+K global shortcut
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    commandPaletteVisible.value = !commandPaletteVisible.value
  }
}

function handlePaletteAction(key: string) {
  switch (key) {
    case 'projects':     projectBoardVisible.value = true; break
    case 'cron':         cronCenterVisible.value = true; break
    case 'timeline':     activityTimelineVisible.value = true; break
    case 'fileManager':  fileManagerVisible.value = true; break
    case 'billing':      billingDialogVisible.value = true; break
    case 'skills':       skillsDialogVisible.value = true; break
    case 'token':        openTokenDetail(); break
    default: break
  }
}

function handlePaletteNavigateAgent(agentId: string) {
  // Scroll to the agent card
  const el = document.querySelector(`[data-agent-id="${agentId}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

onMounted(() => {
  void refreshAll().then(() => checkOpenClawUpdate())
  store.subscribeAgents()
  // Start real-time clock
  updateClock()
  clockTimer = setInterval(updateClock, 60 * 1000) // update every minute
  // REC-031: 工作流进度 — 前台每 10 秒，后台降到 60 秒
  fetchWorkflowData()
  scheduleWorkflowPoll()
  document.addEventListener('visibilitychange', handleWorkflowVisibilityChange)
  // REC-011: 加载超时提示 — 每 1 秒检查
  checkLoadingHint()
  loadingCheckTimer = setInterval(checkLoadingHint, 1000)
  void refreshTokenUsageSnapshot({ blocking: true }).then(() => {
    if (tokenUsageSnapshotReady.value) void prewarmTokenUsageRanges()
  })
  void refreshSummaryUsage()
  fetchLocalAiStatus()
  localAiUsageTimer = setInterval(() => {
    void refreshTokenUsageSnapshot()
    void refreshSummaryUsage()
  }, 60 * 1000)
  tokenUsagePrewarmTimer = setInterval(() => {
    void prewarmTokenUsageRanges()
  }, TOKEN_USAGE_PREWARM_INTERVAL_MS)
  localAiStatusTimer = setInterval(fetchLocalAiStatus, 5 * 1000)
  openClawUpdateTimer = setInterval(() => void checkOpenClawUpdate(), OPENCLAW_UPDATE_CHECK_INTERVAL_MS)
  // Sprint 7: cmd+K
  window.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  tokenUsageSnapshotAbortController?.abort()
  tokenUsageSnapshotAbortController = null
  summaryUsageAbortController?.abort()
  summaryUsageAbortController = null
  if (tokenUsageSnapshotRefreshTimer) {
    clearTimeout(tokenUsageSnapshotRefreshTimer)
    tokenUsageSnapshotRefreshTimer = null
  }
  if (clockTimer) {
    clearInterval(clockTimer)
    clockTimer = null
  }
  if (openClawUpdateTimer) {
    clearInterval(openClawUpdateTimer)
    openClawUpdateTimer = null
  }
  // REC-031: 清理工作流轮询定时器
  if (workflowTimer) {
    clearTimeout(workflowTimer)
    workflowTimer = null
  }
  document.removeEventListener('visibilitychange', handleWorkflowVisibilityChange)
  // REC-011: 清理加载提示定时器
  if (loadingHintTimer) {
    clearTimeout(loadingHintTimer)
    loadingHintTimer = null
  }
  if (loadingCheckTimer) {
    clearInterval(loadingCheckTimer)
    loadingCheckTimer = null
  }
  if (localAiUsageTimer) {
    clearInterval(localAiUsageTimer)
    localAiUsageTimer = null
  }
  if (tokenUsagePrewarmTimer) {
    clearInterval(tokenUsagePrewarmTimer)
    tokenUsagePrewarmTimer = null
  }
  if (localAiStatusTimer) {
    clearInterval(localAiStatusTimer)
    localAiStatusTimer = null
  }
  // Sprint 7: cmd+K
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<style scoped>
/* ==================== LAYOUT ==================== */
.dashboard {
  --dashboard-inline-gutter: clamp(14px, 1.5vw, 40px);
  --dashboard-layout-gap: clamp(12px, 1vw, 24px);
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: scroll;
  scrollbar-gutter: stable;
  overscroll-behavior-y: contain;
  background: var(--bg-primary);
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
}

/* 独立安装窗口由首页根容器统一承接整页滚动，避免滚轮被内部列表或弹窗状态截断。 */
.dashboard > * {
  flex-shrink: 0;
}

.dashboard::-webkit-scrollbar {
  width: 10px;
}

.dashboard::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.025);
}

.dashboard::-webkit-scrollbar-thumb {
  min-height: 48px;
  background: rgba(235, 235, 245, 0.30);
  border: 2px solid var(--bg-primary);
  border-radius: 999px;
}

.dashboard::-webkit-scrollbar-thumb:hover {
  background: rgba(235, 235, 245, 0.48);
}

/* ==================== STATUS BAR ==================== */
.status-bar {
  background:
    linear-gradient(135deg, rgba(28, 28, 30, 0.68), rgba(22, 22, 24, 0.52));
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid rgba(235, 235, 245, 0.11);
  position: sticky;
  top: 0;
  z-index: 100;
  order: 0;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.18);
}

.status-bar-inner {
  width: 100%;
  max-width: none;
  margin: 0 auto;
  padding: 10px var(--dashboard-inline-gutter);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.brand-icon {
  color: var(--accent);
  filter: drop-shadow(0 0 12px rgba(10, 132, 255, 0.24));
}

.brand-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-title {
  color: #f5f5f7;
  -webkit-text-fill-color: #f5f5f7;
  font-size: 18px;
  font-weight: 800;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  white-space: nowrap;
  line-height: 1.2;
}

.brand-name {
  white-space: nowrap;
}

.brand-version {
  font-size: 12px;
  font-weight: 600;
  color: #d1d1d6;
  -webkit-text-fill-color: #d1d1d6;
  white-space: nowrap;
}

.brand-channel {
  font-size: 11px;
  font-weight: 700;
  color: #ff9f0a;
  -webkit-text-fill-color: #ff9f0a;
  background: rgba(255, 159, 10, 0.14);
  border: 1px solid rgba(255, 159, 10, 0.32);
  border-radius: 5px;
  padding: 1px 6px;
  line-height: 1.4;
  white-space: nowrap;
}

.brand-time {
  color: #d1d1d6;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid rgba(209, 209, 214, 0.22);
}

.status-indicators {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* 顶部右侧容器（版本 + 网关 + 通知 + 自定义布局） */
.status-top-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.top-control-slot {
  display: flex;
}

/* 顶部紧凑指示器（共用基础样式） */
.top-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(235, 235, 245, 0.13);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  font-family: inherit;
  white-space: nowrap;
}
.top-indicator:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(10, 132, 255, 0.36);
}

.top-indicator-static {
  cursor: default;
}

.top-indicator-static:hover {
  background: var(--fill-subtle);
}

.top-ind-label {
  color: rgba(229, 229, 234, 0.74);
  font-size: 11px;
}
.top-ind-value {
  color: #f5f5f7;
  font-weight: 600;
  font-size: 12px;
}
.top-ind-value.mono {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
}

/* 版本 */
.top-indicator-version {
  border-color: rgba(10, 132, 255,0.24);
  background: rgba(10, 132, 255,0.08);
}
.top-indicator-version .el-icon { color: #6cb2ff; }
.top-indicator-version .top-ind-value { color: #6cb2ff; }
.top-indicator-version:hover { border-color: rgba(10, 132, 255,0.42); box-shadow: 0 6px 18px rgba(10, 132, 255,0.12); }
.top-indicator-version.has-update {
  border-color: rgba(255, 159, 10, 0.55);
  background: rgba(255, 159, 10, 0.12);
}
.top-indicator-version.has-update .el-icon,
.top-indicator-version.has-update .top-ind-value { color: #ffb340; }
.version-update-badge {
  padding: 1px 5px;
  border-radius: 999px;
  background: #ff9f0a;
  color: #17130b;
  font-size: 9px;
  font-weight: 800;
  line-height: 15px;
}

/* 网关健康 */
.top-indicator-healthy { border-color: rgba(48, 209, 88,0.22); background: rgba(48, 209, 88,0.1); }
.top-indicator-healthy .el-icon, .top-indicator-healthy .top-ind-value { color: #30d158; }
.top-indicator-healthy:hover { border-color: rgba(48, 209, 88,0.4); }
.top-indicator-unhealthy { border-color: rgba(255, 69, 58,0.24); background: rgba(255, 69, 58,0.09); }
.top-indicator-unhealthy .el-icon, .top-indicator-unhealthy .top-ind-value { color: #ff453a; }
.top-indicator-degraded { border-color: rgba(255, 159, 10,0.24); background: rgba(255, 159, 10,0.09); }
.top-indicator-degraded .el-icon, .top-indicator-degraded .top-ind-value { color: #ff9800; }
.top-indicator-unknown .el-icon, .top-indicator-unknown .top-ind-value { color: #ffd54f; }

/* 通知中心 */
.top-indicator-notif { border-color: var(--text-muted); }
.top-indicator-notif.has-unread {
  border-color: rgba(255, 69, 58,0.5);
  background: rgba(255, 69, 58,0.08);
}
.top-indicator-notif.has-unread .el-icon {
  color: #ff453a;
  animation: notif-shake 1.5s ease-in-out infinite;
}
.top-notif-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #ff453a;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  line-height: 16px;
  text-align: center;
  border: 1px solid var(--bg-primary, #161617);
}

/* Sprint 7: 搜索 + 时间线按钮 */
.top-indicator-search { border-color: rgba(94, 92, 230,0.2); background: rgba(94, 92, 230,0.075); }
.top-indicator-search .el-icon { color: #818cf8; }
.top-indicator-search:hover { border-color: rgba(94, 92, 230,0.38); background: rgba(94, 92, 230,0.12); }
.top-ind-kbd {
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 10px;
  color: var(--text-muted);
  font-family: inherit;
}
.top-indicator-timeline { border-color: rgba(48, 209, 88,0.2); background: rgba(48, 209, 88,0.04); }
.top-indicator-timeline .el-icon { color: #4ade80; }
.top-indicator-timeline:hover { border-color: rgba(48, 209, 88,0.5); background: rgba(48, 209, 88,0.12); }

/* #18 主题切换按钮（Dark/Light Theme Toggle Button）*/
.top-indicator-theme { border-color: rgba(255, 159, 10,0.2); background: rgba(255, 159, 10,0.075); }
.top-indicator-theme .theme-icon { font-size: 13px; line-height: 1; }
.top-indicator-theme:hover { border-color: rgba(255, 159, 10,0.38); background: rgba(255, 159, 10,0.12); }

/* 自定义布局按钮 */
.top-layout-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(191, 90, 242,0.08);
  border: 1px solid rgba(191, 90, 242,0.22);
  color: rgba(229, 215, 255, 0.9);
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.top-layout-btn:hover {
  background: rgba(191, 90, 242,0.13);
  border-color: rgba(191, 90, 242,0.38);
  color: #fff;
}

/* ==================== 功能区（action-bar）==================== */
/* ─── 通用可排序模块（时间线 / 版本说明）──────────────────────────────────── */
.module-card-section {
  background: var(--bg-primary);
  padding: 12px var(--dashboard-inline-gutter) 18px;
}

.module-card-shell {
  width: 100%;
  max-width: none;
  margin: 0 auto;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--glass-card-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-inner-highlight), var(--glass-shadow);
  overflow: hidden;
}

.module-card-toggle {
  width: 100%;
  min-height: 62px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.module-card-toggle:hover {
  background: rgba(10, 132, 255, 0.06);
}

.module-card-title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.module-card-eyebrow {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 800;
}

.module-card-title strong {
  color: var(--text-primary);
  font-size: 15px;
  line-height: 1.2;
}

.module-card-hints {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.module-card-hints > span {
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
}

.module-card-badge {
  background: rgba(191, 90, 242,0.15) !important;
  color: #cf7ef5;
  border-color: rgba(191, 90, 242,0.35) !important;
  font-weight: 700;
}

.module-card-arrow {
  color: var(--text-secondary);
  transition: transform 0.18s ease, color 0.18s ease;
}

.module-card-arrow.expanded {
  color: var(--accent);
  transform: rotate(90deg);
}

.module-card-content {
  overflow: hidden;
  border-top: 1px solid var(--border-color);
}

.itl-content {
  padding: 12px 16px 16px;
}

.icl-content {
  padding: 0;
}

.control-dock-section {
  background: var(--bg-primary);
  padding: 12px var(--dashboard-inline-gutter) 18px;
}

.control-dock-inner {
  width: 100%;
  max-width: none;
  margin: 0 auto;
  padding: 14px;
  border: 1px solid rgba(235, 235, 245, 0.14);
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.062), rgba(255, 255, 255, 0.032)),
    rgba(32, 32, 34, 0.58);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.10),
    inset 0 -1px 0 rgba(255, 255, 255, 0.03),
    0 18px 46px rgba(0, 0, 0, 0.22);
  display: grid;
  gap: 14px;
}

.action-bar-inner {
  display: grid;
  grid-template-columns: repeat(30, minmax(0, 1fr));
  gap: 10px;
}
.action-slot {
  display: flex;
  width: 100%;
  grid-column: span 5;
}
.action-slot--primary {
  grid-column: span 5;
}
.action-slot--primary-last {
  grid-column: span 5;
}
.action-slot--secondary-wide {
  grid-column: span 5;
}
.action-slot--secondary {
  grid-column: span 5;
}
.action-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 76px;
  padding: 13px 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.035)),
    rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(235, 235, 245, 0.14);
  border-radius: 10px;
  color: var(--text-primary, #e5e5ea);
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  width: 100%;
  min-width: 0;  /* 允许收缩到 grid 单元宽度 */
  height: 100%;
  text-align: left;
  font-family: inherit;
}
.action-btn:hover {
  background: rgba(255, 255, 255, 0.085);
  border-color: rgba(235, 235, 245, 0.24);
  transform: translateY(-1px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 10px 28px rgba(0, 0, 0, 0.18);
}
.action-btn .el-icon {
  flex-shrink: 0;
  color: var(--accent, #0a84ff);
}
.action-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.action-label {
  font-size: 11px;
  color: var(--text-secondary, #98989d);
  font-weight: 500;
  letter-spacing: 0.3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.action-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #e5e5ea);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.action-value.mono {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 13px;
}
.action-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #ff453a;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 9px;
  line-height: 18px;
  text-align: center;
  border: 2px solid var(--bg-primary, #161617);
}

/* 健康状态变体 */
.action-btn.action-healthy .el-icon { color: #30d158; }
.action-btn.action-healthy { border-color: rgba(48, 209, 88,0.2); background: rgba(48, 209, 88,0.065); }
.action-btn.action-healthy:hover { border-color: rgba(48, 209, 88,0.36); box-shadow: 0 8px 22px rgba(48, 209, 88,0.12); }

.action-btn.action-unhealthy .el-icon { color: #ff453a; }
.action-btn.action-unhealthy { border-color: rgba(255, 69, 58,0.22); background: rgba(255, 69, 58,0.075); }

.action-btn.action-degraded .el-icon { color: #ff9800; }
.action-btn.action-degraded { border-color: rgba(255, 159, 10,0.22); background: rgba(255, 159, 10,0.06); }

.action-btn.action-unknown .el-icon { color: #ffd54f; }

.action-btn.action-version .el-icon,
.action-btn.action-version .action-value { color: #6cb2ff; }
.action-btn.action-version { border-color: rgba(10, 132, 255,0.2); background: rgba(10, 132, 255,0.065); }

.action-btn.action-gpu .el-icon { color: #cf7ef5; }
.action-btn.action-gpu .action-value { color: #e5c0fa; font-family: 'Cascadia Code', monospace; }
.action-btn.action-gpu { border-color: rgba(191, 90, 242,0.25); background: rgba(191, 90, 242,0.04); }

.action-btn.action-notif.has-unread {
  border-color: rgba(255, 69, 58,0.5);
  background: rgba(255, 69, 58,0.08);
}
.action-btn.action-notif.has-unread .el-icon {
  color: #ff453a;
  animation: notif-shake 1.5s ease-in-out infinite;
}

.indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 16px;
  font-size: 12px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  transition: all 0.3s;
  cursor: pointer;
}

.indicator:hover {
  border-color: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}

.indicator-label {
  color: var(--text-secondary);
}

.indicator-value {
  color: var(--text-primary);
  font-weight: 600;
}

.health-healthy { background: rgba(48, 209, 88, 0.15); color: #81c784; border-color: rgba(48, 209, 88,0.3) !important; }
.health-degraded { background: rgba(255, 159, 10, 0.15); color: #ffb74d; border-color: rgba(255, 159, 10,0.3) !important; }
.health-unhealthy { background: rgba(255, 69, 58, 0.15); color: #e57373; border-color: rgba(255, 69, 58,0.3) !important; }
.health-unknown { background: rgba(255, 159, 10, 0.15); color: #ffd54f; border-color: rgba(255, 159, 10,0.3) !important; }

.indicator-version {
  background: rgba(10, 132, 255, 0.15);
  border-color: rgba(10, 132, 255,0.3) !important;
}

.indicator-version .indicator-label {
  color: #64b5f6;
  font-weight: 600;
}

.indicator-version .indicator-value {
  color: #6cb2ff;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.indicator-gpu {
  background: rgba(191, 90, 242, 0.15);
  border-color: rgba(191, 90, 242,0.3) !important;
}

.indicator-gpu .indicator-label {
  color: #cf7ef5;
  font-weight: 600;
}

.indicator-gpu .indicator-value {
  color: #e5c0fa;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.indicator-action {
  cursor: pointer;
  user-select: none;
}
.indicator-action:hover {
  border-color: var(--accent);
  background: rgba(10, 132, 255, 0.12);
  box-shadow: 0 0 8px var(--accent-glow);
}
.indicator-action .indicator-label {
  color: var(--text-primary);
  font-weight: 500;
}

/* 自定义布局：每个 indicator 外层包装，作为 flex 直接子元素以接收 order */
.indicator-slot {
  display: inline-flex;
  align-items: center;
}

/* 自定义布局按钮 */
.indicator-layout {
  padding: 5px 8px !important;
  background: var(--fill-subtle);
  opacity: 0.6;
}
.indicator-layout:hover {
  opacity: 1;
  background: rgba(191, 90, 242, 0.15);
  border-color: rgba(191, 90, 242,0.4) !important;
}

/* 通知铃铛 */
.notif-bell {
  position: relative;
}
.notif-bell.has-unread {
  border-color: rgba(255, 69, 58,0.4) !important;
  background: rgba(255, 69, 58,0.08);
}
.notif-bell.has-unread .el-icon {
  color: #ff453a;
  animation: notif-shake 1.5s ease-in-out infinite;
}
@keyframes notif-shake {
  0%, 100% { transform: rotate(0deg); }
  10%, 30% { transform: rotate(-15deg); }
  20%, 40% { transform: rotate(15deg); }
  50% { transform: rotate(0deg); }
}
.notif-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #ff453a;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  line-height: 16px;
  text-align: center;
  border: 1px solid rgba(0,0,0,0.3);
}

.loading-hint-alert {
  position: fixed;
  top: 70px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  min-width: 280px;
  animation: loadingHintFadeIn 0.3s ease;
}

@keyframes loadingHintFadeIn {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ==================== COCKPIT SECTION ==================== */
.cockpit-section {
  background: var(--bg-primary);
  padding: 20px var(--dashboard-inline-gutter) 10px;
}

.scope-toolbar {
  width: 100%;
  max-width: none;
  margin: 0 auto 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--glass-card-border);
  border-radius: 14px;
  background: rgba(32, 32, 34, 0.58);
  box-shadow: var(--glass-inner-highlight), var(--glass-shadow);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}

.usage-snapshot-refreshing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #64a8ff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.usage-snapshot-refreshing i {
  width: 10px;
  height: 10px;
  border: 2px solid rgba(10, 132, 255, 0.28);
  border-top-color: #0a84ff;
  border-radius: 50%;
  animation: usage-snapshot-spin 0.8s linear infinite;
}

@keyframes usage-snapshot-spin {
  to { transform: rotate(360deg); }
}

.scope-toolbar-panel {
  border: 0;
  border-radius: 0;
  background: transparent;
  min-height: 0;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.scope-toolbar-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
  min-height: 30px;
  padding: 0 10px 0 4px;
}

.scope-toolbar-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  flex: 0 0 auto;
  min-width: 0;
  min-height: 28px;
  padding: 0;
}

.scope-control-label {
  color: var(--text-primary, #e5e5ea);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  white-space: nowrap;
}

.scope-control-group {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 3px;
  border: 1px solid rgba(235, 235, 245, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.035);
}

.token-mini-custom-range {
  width: 230px !important;
  flex: 0 0 230px;
}

.token-mini-custom-range,
.token-mini-custom-range.el-input__wrapper {
  height: 25px !important;
  min-height: 25px !important;
  border-radius: 999px !important;
  background: rgba(255, 255, 255, 0.026) !important;
  border: 1px solid rgba(235, 235, 245, 0.10) !important;
  box-shadow: none !important;
  padding: 0 7px !important;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.token-mini-custom-range :deep(.el-input__wrapper) {
  min-height: 25px;
  border-radius: 999px !important;
  background: transparent;
  border: 0;
  box-shadow: none !important;
  padding: 0;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.token-mini-custom-range:hover,
.token-mini-custom-range :deep(.el-input__wrapper:hover) {
  border-color: rgba(10, 132, 255, 0.3);
  background: rgba(255, 255, 255, 0.06);
}

.token-mini-custom-range.active,
.token-mini-custom-range.active :deep(.el-input__wrapper) {
  border-color: rgba(48, 209, 88, 0.28);
  background: rgba(48, 209, 88, 0.065);
}

.token-mini-custom-range :deep(.el-range-input) {
  color: var(--text-primary, #e5e5ea);
  font-size: 10px;
  font-weight: 700;
}

.token-mini-custom-range :deep(.el-range-input::placeholder),
.token-mini-custom-range :deep(.el-range-separator),
.token-mini-custom-range :deep(.el-range__icon),
.token-mini-custom-range :deep(.el-range__close-icon) {
  color: var(--text-secondary, #98989d);
}

.token-mini-metrics {
  border-color: rgba(10, 132, 255, 0.16);
  background: rgba(10, 132, 255, 0.035);
}

.clear-chip {
  border-color: rgba(255, 159, 10, 0.28);
  color: rgba(255, 214, 102, 0.92);
}

.cockpit-inner {
  width: 100%;
  max-width: none;
  margin: 0 auto;
  display: grid;
  grid-template-columns:
    minmax(360px, 1fr)
    520px
    clamp(420px, calc(420px + (100vw - 1440px) * 0.08), 520px);
  gap: var(--dashboard-layout-gap);
  align-items: stretch;
}

.cockpit-card {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.035)),
    rgba(32, 32, 34, 0.58);
  border: 1px solid rgba(235, 235, 245, 0.15);
  border-radius: 8px;
  padding: 16px;
  min-width: 0;
  height: calc(clamp(470px, 24vw, 500px) + 29px);
  min-height: 499px;
  max-height: 529px;
  display: flex;
  flex-direction: column;
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.11),
    inset 0 -1px 0 rgba(255, 255, 255, 0.035),
    0 18px 46px rgba(0, 0, 0, 0.22);
}

@media (min-width: 1281px) {
  .cockpit-inner.has-expanded-summary .cockpit-card {
    height: calc(clamp(470px, 24vw, 500px) + 176px);
    min-height: 646px;
    max-height: 676px;
  }
}

.contribution-card {
  min-height: 499px;
}

.token-cockpit-card {
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  overflow: hidden;
}

.token-cockpit-card:hover {
  border-color: rgba(235, 235, 245, 0.22);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(255, 255, 255, 0.04),
    0 22px 54px rgba(0, 0, 0, 0.28);
  transform: translateY(-1px);
}

.cockpit-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 8px;
}

.cockpit-eyebrow {
  color: var(--text-secondary, #98989d);
  font-size: 12px;
  font-weight: 700;
}

.token-mini-control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 4px 0 10px;
}

.token-mini-ranges,
.token-mini-metrics {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  min-width: 0;
}

.token-mini-metrics {
  justify-content: flex-end;
  flex-shrink: 0;
}

.token-mini-chip {
  border: 1px solid rgba(235, 235, 245, 0.12);
  background: rgba(255, 255, 255, 0.045);
  color: var(--text-secondary, #98989d);
  border-radius: 999px;
  min-height: 23px;
  padding: 0 7px;
  font-size: 11px;
  font-weight: 700;
  line-height: 21px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
  white-space: nowrap;
}

.token-mini-chip:hover {
  border-color: rgba(10, 132, 255, 0.3);
  color: rgba(179, 215, 255, 0.95);
}

.token-mini-chip.active {
  border-color: rgba(48, 209, 88, 0.36);
  background: rgba(48, 209, 88, 0.13);
  color: #bbf7d0;
}

.token-mini-chip.metric-chip.active {
  border-color: rgba(10, 132, 255, 0.36);
  background: rgba(10, 132, 255, 0.13);
  color: #b3d7ff;
}

.token-kpi-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 7px;
}

.token-kpi-row > div {
  background: rgba(255, 255, 255, 0.052);
  border: 1px solid rgba(235, 235, 245, 0.12);
  border-radius: 8px;
  padding: 9px 11px;
  min-width: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.075);
}

.token-kpi-row span,
.model-share-name,
.agent-pulse-status {
  display: block;
  color: var(--text-secondary, #98989d);
  font-size: 11px;
}

.token-kpi-row strong {
  display: block;
  color: var(--text-primary, #e5e5ea);
  font-size: 15px;
  line-height: 1.3;
  margin-top: 4px;
  word-break: break-word;
}

@media (max-width: 760px) {
  .token-kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .token-kpi-row {
    grid-template-columns: minmax(0, 1fr);
  }
}

.token-mini-chart {
  position: relative;
  border: 1px solid rgba(235, 235, 245, 0.12);
  background: rgba(255, 255, 255, 0.045);
  border-radius: 12px;
  padding: 9px 11px 6px;
  height: auto;
  min-height: 130px;
  max-height: none;
  margin-bottom: 8px;
  overflow: hidden;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    inset 0 -1px 0 rgba(255, 255, 255, 0.025);
  backdrop-filter: blur(14px) saturate(1.22);
  -webkit-backdrop-filter: blur(14px) saturate(1.22);
}

.token-mini-chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  color: var(--text-secondary, #98989d);
  font-size: 11px;
  font-weight: 700;
}

.token-mini-chart-metrics {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.token-mini-chart-chip {
  border: 1px solid rgba(235, 235, 245, 0.12);
  background: rgba(255, 255, 255, 0.045);
  color: var(--text-secondary, #98989d);
  border-radius: 999px;
  min-height: 22px;
  padding: 0 7px;
  font-size: 10px;
  font-weight: 800;
  line-height: 20px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
  white-space: nowrap;
}

.token-mini-chart-chip:hover {
  border-color: rgba(10, 132, 255, 0.32);
  color: rgba(179, 215, 255, 0.95);
}

.token-mini-chart-chip.active {
  border-color: rgba(10, 132, 255, 0.36);
  background: rgba(10, 132, 255, 0.13);
  color: #b3d7ff;
}

.token-mini-chart-head strong {
  color: #e5e5ea;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}





.token-mini-peak text {
  font-size: 9.5px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  paint-order: stroke;
  stroke: rgba(8, 8, 10, 0.78);
  stroke-width: 1.1px;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.22));
}

.token-mini-tooltip {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, calc(-100% - 8px));
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 118px;
  padding: 7px 9px;
  border: 1px solid rgba(235, 235, 245, 0.16);
  border-radius: 8px;
  background: rgba(28, 28, 30, 0.88);
  color: var(--text-primary, #e5e5ea);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  pointer-events: none;
  backdrop-filter: blur(18px) saturate(1.18);
  -webkit-backdrop-filter: blur(18px) saturate(1.18);
}

.token-mini-tooltip span {
  color: var(--text-secondary, #98989d);
  font-size: 10px;
  font-weight: 700;
}

.token-mini-tooltip strong {
  color: inherit;
  font-size: 12px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.token-mini-plot {
  position: relative;
  flex: 1;
  min-height: 0;
}
.token-mini-plot .token-mini-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.token-mini-axis-label {
  font-size: 10.5px;
  fill: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.token-mini-date-label {
  font-size: 10.5px;
  fill: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.token-mini-axis-label.is-cost { fill: #30d158; opacity: 0.9; }
.token-mini-axis-label.is-token { fill: #0a84ff; opacity: 0.9; }
.token-mini-value-label {
  font-size: 10.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  paint-order: stroke;
  stroke: var(--bg-primary);
  stroke-width: 3.5px;
  stroke-linejoin: round;
}
.token-mini-axis {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgba(152, 152, 157, 0.72);
  font-size: 10px;
  line-height: 1;
  margin-top: 2px;
  flex: 0 0 auto;
}

.token-mini-chart-empty {
  min-height: 76px;
  display: grid;
  place-items: center;
  color: rgba(152, 152, 157, 0.72);
  font-size: 12px;
}

.model-share-scroll {
  flex: 0 0 104px;
  height: 104px;
}

.model-share-scroll.is-expanded {
  flex-basis: 248px;
  height: 248px;
}

.model-share-scroll :deep(.el-scrollbar__wrap) {
  overflow-x: hidden;
}

.model-share-scroll:not(.is-expanded) :deep(.el-scrollbar__wrap),
.contribution-scroll:not(.is-expanded) :deep(.el-scrollbar__wrap) {
  overflow-y: hidden;
}

.model-share-scroll :deep(.el-scrollbar__bar.is-vertical),
.contribution-scroll :deep(.el-scrollbar__bar.is-vertical) {
  right: 1px;
  width: 8px;
  opacity: 1;
}

.model-share-scroll :deep(.el-scrollbar__thumb),
.contribution-scroll :deep(.el-scrollbar__thumb) {
  background: rgba(152, 152, 157, 0.62);
  opacity: 1;
}

.model-share-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 12px;
}

.model-share-list--scrollable {
  max-height: none;
  overflow: visible;
}

.model-share-list--scrollable::-webkit-scrollbar {
  width: 5px;
}

.model-share-list--scrollable::-webkit-scrollbar-thumb {
  background: rgba(152, 152, 157, 0.35);
  border-radius: 999px;
}

.model-share-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  font-size: 12.5px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  padding: 3px 10px;
  min-height: 32px;
  cursor: pointer;
  text-align: left;
  transition: background 0.18s ease, border-color 0.18s ease, opacity 0.18s ease;
}

.model-share-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.model-share-row.active {
  border-color: rgba(235, 235, 245, 0.14);
  background: rgba(255, 255, 255, 0.065);
  box-shadow: none;
}

.model-share-row.muted {
  opacity: 0.42;
}

.agent-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.model-brand-mark {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  color: #fff;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 5px 14px rgba(0,0,0,0.14);
  overflow: hidden;
}

.model-brand-img {
  width: 14px;
  height: 14px;
  display: block;
  object-fit: contain;
}

.model-brand-mark--deepseek { background: linear-gradient(135deg, rgba(94, 92, 230, 0.86), rgba(70, 68, 184, 0.74)); }
.model-brand-mark--minimax { background: linear-gradient(135deg, rgba(48, 209, 88, 0.82), rgba(31, 158, 67, 0.72)); }
.model-brand-mark--openai { background: linear-gradient(135deg, rgba(10, 132, 255, 0.86), rgba(0, 100, 210, 0.74)); }
.model-brand-mark--anthropic { background: linear-gradient(135deg, rgba(255, 159, 10, 0.84), rgba(217, 126, 6, 0.72)); }
.model-brand-mark--qwen { background: linear-gradient(135deg, rgba(191, 90, 242, 0.82), rgba(142, 68, 201, 0.72)); }
.model-brand-mark--google { background: linear-gradient(135deg, rgba(10, 132, 255, 0.82), rgba(48, 209, 88, 0.62)); }
.model-brand-mark--local { background: linear-gradient(135deg, rgba(48, 209, 88, 0.78), rgba(10, 132, 255, 0.58)); }
.model-brand-mark--generic { background: linear-gradient(135deg, rgba(142, 142, 147, 0.72), rgba(99, 102, 241, 0.58)); }

.model-share-token {
  color: var(--text-primary, #e5e5ea);
  font-weight: 700;
  white-space: nowrap;
}
/* 双指标模型值:横向前后排,省空间 */
.model-share-token.metric-pair {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.metric-pair {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  line-height: 1.15;
}


.model-share-pct {
  color: var(--text-muted, #8e8e93);
  font-variant-numeric: tabular-nums;
  width: 34px;
  text-align: right;
}

.agent-pulse-summary {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  color: var(--text-secondary, #98989d);
  font-size: 11px;
  white-space: nowrap;
}

.agent-pulse-app-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 4px 0 10px;
  flex: 0 0 auto;
}

.agent-pulse-card {
  container-type: inline-size;
}

.agent-pulse-app-tab {
  min-width: 0;
  min-height: 66px;
  border: 1px solid rgba(235, 235, 245, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.044);
  color: inherit;
  font-family: inherit;
  padding: 9px;
  text-align: left;
  cursor: pointer;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  grid-template-rows: auto auto auto;
  grid-template-areas:
    "icon name"
    "icon meta"
    "icon value";
  gap: 2px 9px;
  align-items: center;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.agent-pulse-app-tab:hover {
  border-color: rgba(235, 235, 245, 0.22);
  background: rgba(255, 255, 255, 0.064);
}

.agent-pulse-app-tab.active {
  border-color: rgba(10, 132, 255, 0.34);
  background: rgba(10, 132, 255, 0.1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.agent-pulse-app-icon {
  grid-area: icon;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  place-items: center;
  align-self: center;
  background: linear-gradient(135deg, rgba(28, 28, 30, 0.96), rgba(72, 72, 74, 0.86));
  border: 1px solid rgba(235, 235, 245, 0.14);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.agent-pulse-app-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  padding: 0;
  display: block;
}

.agent-pulse-app-icon.is-claude-code {
  background: #df7653;
}

.agent-pulse-app-icon.is-claude-code img {
  transform: scale(1.32);
}

.agent-pulse-app-name {
  grid-area: name;
  color: var(--text-primary, #e5e5ea);
  font-size: 12px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-pulse-app-meta {
  grid-area: meta;
  color: var(--text-secondary, #98989d);
  font-size: 10px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-pulse-app-value {
  grid-area: value;
  font-size: 12px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-pulse-filter-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
  padding: 5px 8px;
  margin: -2px 0 8px;
  border: 1px solid rgba(10, 132, 255, 0.22);
  border-radius: 8px;
  background: rgba(10, 132, 255, 0.08);
  color: #b3d7ff;
  font-size: 11px;
  font-weight: 800;
}

.agent-pulse-filter-strip button {
  border: 0;
  background: transparent;
  color: #7ab8ff;
  font: inherit;
  cursor: pointer;
  padding: 2px 0;
  white-space: nowrap;
}

.agent-pulse-filter-strip button:hover {
  color: #d6eaff;
}

.agent-pulse-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(62px, max-content);
  gap: 10px;
  flex: 1;
  align-content: start;
  min-height: 0;
  overflow: hidden;
}

.agent-pulse-grid--two-level {
  grid-auto-rows: minmax(62px, max-content);
  max-height: none;
  overflow-y: hidden;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(152, 152, 157, 0.35) transparent;
}

.agent-pulse-grid--two-level.is-scrollable {
  overflow-y: auto;
}

.agent-pulse-grid--two-level::-webkit-scrollbar {
  width: 5px;
}

.agent-pulse-grid--two-level::-webkit-scrollbar-thumb {
  background: rgba(152, 152, 157, 0.35);
  border-radius: 999px;
}

.agent-pulse-item {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  grid-template-areas:
    "avatar name token"
    "avatar status token";
  gap: 3px 10px;
  align-items: center;
  text-align: left;
  padding: 9px 12px;
  min-height: 62px;
  border-radius: 10px;
  border: 1px solid rgba(235, 235, 245, 0.12);
  background: rgba(255, 255, 255, 0.048);
  color: inherit;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.agent-pulse-item:only-child {
  grid-column: 1 / -1;
  min-height: clamp(92px, 16cqi, 148px);
}

.agent-pulse-item.is-local-source {
  cursor: default;
}

.agent-pulse-item:hover {
  border-color: rgba(235, 235, 245, 0.2);
  background: rgba(255, 255, 255, 0.07);
}

.agent-pulse-avatar-wrap {
  grid-area: avatar;
  width: 38px;
  height: 38px;
  position: relative;
  align-self: center;
}

.agent-pulse-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  border: 1px solid rgba(235, 235, 245, 0.16);
  background: rgba(255, 255, 255, 0.08);
}

.agent-pulse-avatar.is-claude-code {
  background: #df7653;
  transform: scale(1.24);
}

.agent-pulse-avatar-placeholder {
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: #fff;
  font-size: 11px;
  font-weight: 900;
  background: linear-gradient(135deg, rgba(10, 132, 255, 0.78), rgba(48, 209, 88, 0.5));
}

.agent-pulse-item .agent-pulse-dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--bg-card, #2c2c2e);
}
.agent-pulse-title {
  grid-area: name;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.agent-pulse-name {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-primary, #e5e5ea);
  font-size: 13px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-pulse-status { grid-area: status; }
.agent-pulse-token {
  grid-area: token;
  color: var(--text-primary, #e5e5ea);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  justify-self: end;
}

.agent-pulse-item.is-running .agent-pulse-dot { background: #ff9f0a; box-shadow: 0 0 10px rgba(255, 159, 10, 0.55); }
.agent-pulse-item.is-recent .agent-pulse-dot { background: #0a84ff; }
.agent-pulse-item.is-idle .agent-pulse-dot { background: #30d158; box-shadow: 0 0 10px rgba(48, 209, 88, 0.42); }
.agent-pulse-item.is-error .agent-pulse-dot { background: #ff453a; }
.agent-pulse-item.is-aborted .agent-pulse-dot { background: #98989d; }

.agent-pulse-empty {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  border: 1px dashed rgba(235, 235, 245, 0.16);
  border-radius: 8px;
  color: var(--text-secondary, #98989d);
  font-size: 12px;
  font-weight: 700;
}

.cockpit-link-btn {
  border: 1px solid rgba(10, 132, 255, 0.3);
  background: rgba(10, 132, 255, 0.08);
  color: #6cb2ff;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.cockpit-link-btn:hover {
  border-color: rgba(10, 132, 255, 0.65);
  background: rgba(10, 132, 255, 0.15);
}

.cockpit-disclosure {
  align-self: center;
  flex: 0 0 auto;
  min-height: 24px;
  margin-top: 5px;
  padding: 2px 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #6cb2ff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 20px;
  cursor: pointer;
  transition: color 0.18s ease, background 0.18s ease;
}

.cockpit-disclosure:hover {
  color: #b3d7ff;
  background: rgba(10, 132, 255, 0.09);
}

.cockpit-disclosure-spacer {
  display: block;
  align-self: center;
  flex: 0 0 24px;
  min-height: 24px;
  margin-top: 5px;
}

.contribution-scroll {
  flex: 1;
  min-height: 0;
}

.contribution-scroll:not(.is-expanded) {
  flex: 0 0 318px;
  height: 318px;
}

.contribution-scroll :deep(.el-scrollbar__wrap) {
  overflow-x: hidden;
}

.contribution-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 12px;
}

.contribution-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 5px 6px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.16s ease, transform 0.16s ease;
}

.contribution-row:hover {
  background: rgba(255, 255, 255, 0.045);
  transform: translateX(1px);
}

.contribution-person {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.contribution-rank {
  display: none;
}

.contribution-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  border: 1px solid rgba(235, 235, 245, 0.16);
  background: rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.contribution-avatar.is-claude-code {
  background: #df7653;
  transform: scale(1.24);
}

.contribution-body {
  min-width: 0;
  flex: 1;
}

.contribution-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 3px;
  font-size: 12px;
}

.contribution-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.contribution-name {
  flex: 1 1 auto;
  min-width: 0;
}

.contribution-line span {
  color: var(--text-primary, #e5e5ea);
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contribution-line strong {
  color: var(--text-primary, #e5e5ea);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.contribution-value.metric-pair {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.contribution-bar {
  height: 3px;
  border-radius: 999px;
  background: rgba(152, 152, 157, 0.13);
  overflow: hidden;
}
.contribution-bar--cost {
  margin-top: 3px;
}
.contribution-body {
  min-width: 0;
}

.contribution-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #0a84ff;
}

.contribution-empty {
  color: var(--text-secondary, #98989d);
  font-size: 13px;
  padding: 18px 0;
}

/* ==================== MONITOR OBJECTS DETAIL ==================== */
:deep(.monitor-objects-dialog) {
  --el-dialog-bg-color: rgba(28, 28, 30, 0.96);
  --el-dialog-border-radius: 10px;
  border: 1px solid rgba(235, 235, 245, 0.14);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.38);
}

:deep(.monitor-objects-dialog .el-dialog__header) {
  padding: 18px 20px 10px;
  margin-right: 0;
}

:deep(.monitor-objects-dialog .el-dialog__body) {
  padding: 0 20px 20px;
}

.monitor-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding-right: 32px;
}

.monitor-detail-eyebrow {
  color: var(--text-secondary, #98989d);
  font-size: 12px;
  font-weight: 800;
}

.monitor-detail-head h2 {
  margin: 2px 0 0;
  color: var(--text-primary, #e5e5ea);
  font-size: 20px;
  line-height: 1.2;
}

.monitor-detail-head-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  color: var(--text-secondary, #98989d);
  font-size: 11px;
  font-weight: 800;
}

.monitor-detail-head-meta strong {
  color: #0a84ff;
  font-size: 20px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.monitor-detail-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.monitor-detail-tabs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.monitor-detail-tab {
  min-width: 0;
  min-height: 56px;
  border: 1px solid rgba(235, 235, 245, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.045);
  color: var(--text-secondary, #98989d);
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.monitor-detail-tab span {
  font-size: 12px;
  font-weight: 800;
}

.monitor-detail-tab strong {
  color: var(--text-primary, #e5e5ea);
  font-size: 22px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.monitor-detail-tab:hover,
.monitor-detail-tab.active {
  border-color: rgba(10, 132, 255, 0.34);
  background: rgba(10, 132, 255, 0.11);
  color: #b3d7ff;
}

.monitor-detail-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(235, 235, 245, 0.10);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
}

.monitor-source-filter,
.monitor-detail-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  min-width: 0;
}

.monitor-toolbar-label {
  color: var(--text-secondary, #98989d);
  font-size: 12px;
  font-weight: 800;
}

.monitor-source-chip,
.monitor-action-btn {
  min-height: 28px;
  border: 1px solid rgba(235, 235, 245, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.045);
  color: var(--text-secondary, #98989d);
  font-family: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
}

.monitor-source-chip img {
  width: 17px;
  height: 17px;
  border-radius: 5px;
  object-fit: cover;
}

.monitor-source-chip strong {
  color: var(--text-primary, #e5e5ea);
  font-variant-numeric: tabular-nums;
}

.monitor-source-chip.active,
.monitor-action-btn.active {
  border-color: rgba(48, 209, 88, 0.32);
  background: rgba(48, 209, 88, 0.09);
  color: #a8f0b6;
}

.monitor-action-btn.danger {
  border-color: rgba(255, 69, 58, 0.22);
  color: #ffb4ad;
}

.monitor-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.monitor-source-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.monitor-source-card {
  min-width: 0;
  min-height: 58px;
  border: 1px solid rgba(235, 235, 245, 0.10);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.032);
  padding: 9px 11px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 8px;
}

.monitor-source-card span {
  color: var(--text-secondary, #98989d);
  font-size: 11px;
  font-weight: 800;
}

.monitor-source-card strong {
  color: var(--text-primary, #e5e5ea);
  font-size: 20px;
  line-height: 1;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.monitor-source-card em {
  grid-column: 1 / -1;
  color: #0a84ff;
  font-size: 12px;
  font-style: normal;
  font-weight: 900;
}

.monitor-object-list {
  max-height: min(52vh, 520px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 4px;
}

.monitor-object-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) minmax(110px, auto) auto;
  align-items: center;
  gap: 12px;
  min-height: 66px;
  border: 1px solid rgba(235, 235, 245, 0.11);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  padding: 10px 11px;
}

.monitor-object-row.hidden {
  border-style: dashed;
  opacity: 0.78;
}

.monitor-object-avatar-wrap {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}

.monitor-object-avatar {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.monitor-object-avatar.is-claude-code {
  background: #df7653;
  transform: scale(1.18);
}

.monitor-object-avatar-placeholder {
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
  background: linear-gradient(135deg, rgba(10, 132, 255, 0.78), rgba(48, 209, 88, 0.5));
}

.monitor-object-main {
  min-width: 0;
}

.monitor-object-title,
.monitor-object-sub,
.monitor-object-metrics,
.monitor-object-actions {
  display: flex;
  align-items: center;
}

.monitor-object-title {
  gap: 8px;
  min-width: 0;
}

.monitor-object-title strong {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #e5e5ea);
  font-size: 14px;
}

.monitor-object-title span {
  flex: 0 0 auto;
  color: var(--text-secondary, #98989d);
  font-size: 11px;
  font-weight: 800;
}

.monitor-object-sub {
  gap: 8px;
  margin-top: 5px;
  color: var(--text-secondary, #98989d);
  font-size: 11px;
  font-weight: 700;
}

.monitor-status-badge {
  border-radius: 999px;
  padding: 2px 7px;
  background: rgba(152, 152, 157, 0.12);
  color: #c7c7cc;
  font-size: 10px;
  font-weight: 900;
}

.monitor-status-badge.is-running { color: #86efac; background: rgba(48, 209, 88, 0.13); }
.monitor-status-badge.is-recent { color: #7ab8ff; background: rgba(10, 132, 255, 0.13); }
.monitor-status-badge.is-idle { color: #ffd166; background: rgba(255, 159, 10, 0.13); }
.monitor-status-badge.is-aborted { color: #c7c7cc; background: rgba(152, 152, 157, 0.13); }
.monitor-status-badge.is-error { color: #ffb4ad; background: rgba(255, 69, 58, 0.13); }

.monitor-object-metrics {
  justify-content: flex-end;
  gap: 8px;
  font-size: 13px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.monitor-object-actions {
  justify-content: flex-end;
  gap: 6px;
}

.monitor-object-actions button {
  min-height: 28px;
  border: 1px solid rgba(10, 132, 255, 0.22);
  border-radius: 7px;
  background: rgba(10, 132, 255, 0.08);
  color: #7ab8ff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;
  padding: 0 9px;
}

.monitor-object-actions button:hover {
  border-color: rgba(10, 132, 255, 0.42);
  color: #d6eaff;
}

.monitor-object-empty {
  min-height: 160px;
  display: grid;
  place-items: center;
  border: 1px dashed rgba(235, 235, 245, 0.16);
  border-radius: 8px;
  color: var(--text-secondary, #98989d);
  font-size: 13px;
  font-weight: 800;
}

/* ==================== OPS SUMMARY ==================== */
.summary-range-dialog-head h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 21px;
}

.summary-range-dialog-head p {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.summary-range-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 4px 0 8px;
}

.summary-range-option {
  min-height: 42px;
  justify-content: center;
}

.ops-summary-list {
  display: grid;
  grid-template-columns: repeat(30, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;
}

.stat-pill {
  min-width: 0;
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 11px;
  border: 1px solid rgba(235, 235, 245, 0.14);
  border-radius: 9px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.035)),
    rgba(255, 255, 255, 0.035);
  color: var(--text-primary);
  font-family: inherit;
  text-align: left;
  cursor: default;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.stat-pill.stat-clickable {
  cursor: pointer;
}

.stat-total,
.stat-running,
.stat-idle,
.stat-aborted,
.stat-error {
  grid-column: span 3;
}

.stat-uptime {
  grid-column: span 5;
}

.stat-tokens,
.stat-cost {
  grid-column: span 5;
}

.stat-pill:hover {
  border-color: rgba(235, 235, 245, 0.24);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 10px 28px rgba(0, 0, 0, 0.18);
  transform: translateY(-1px);
}

.stat-icon-wrap {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.stat-number {
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.08;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: none;
  letter-spacing: 0;
  line-height: 1.25;
  min-width: 0;
}

.stat-uptime .stat-number,
.stat-tokens .stat-number,
.stat-cost .stat-number {
  font-size: 18px;
}

.stat-subtitle {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.84;
  max-width: 100%;
  line-height: 1.25;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

 .icon-blue { background: rgba(10, 132, 255, 0.12); color: #64b5ff; }
 .icon-green { background: rgba(48, 209, 88, 0.12); color: #67d783; }
 .icon-yellow { background: rgba(255, 159, 10, 0.12); color: #ffd166; }
 .icon-red { background: rgba(255, 69, 58, 0.12); color: #ff7a70; }
 .icon-gray { background: rgba(142, 142, 147, 0.12); color: #a1a1aa; }
 .icon-purple { background: rgba(191, 90, 242, 0.12); color: #d5a6ff; }
 .icon-orange { background: rgba(249, 115, 22, 0.12); color: #ffb366; }

/* ==================== WORKFLOW STEPS / DIVIDER ==================== */
.workflow-section {
  width: 100%;
  max-width: none;
  margin: 0 auto;
  padding: 8px var(--dashboard-inline-gutter);
}

/* REC-029: workflow-steps-wrapper 已移除，padding 合并到 workflow-section */

.workflow-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  transition: all 0.3s;
}

.workflow-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 4px;
}

.workflow-project-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.workflow-step-label {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 8px;
  background: var(--bg-card-hover);
  border-radius: 4px;
}

.workflow-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 16px var(--accent-glow);
}

.workflow-card :deep(.el-card__body) {
  padding: 8px 16px;
}

/* 自定义步进条布局 (模仿 Element Plus Simple) */
.workflow-steps-simple {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  gap: 0;
  width: 100%;
  overflow: auto;
  padding: 8px 0;
}

.workflow-step-simple-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-width: 80px;
}

.workflow-step-simple-item.is-active .simple-step-title {
  color: var(--el-color-primary);
  font-weight: 600;
}

/* 圆点指示器 (Element Plus Simple 风格) */
.simple-step-circle {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  transition: all 0.3s;
}

.simple-step-finished {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.simple-step-process {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  box-shadow: 0 0 8px var(--accent-glow);
}

.workflow-step-simple-item.is-active .simple-step-process {
  background: transparent;
  border-color: var(--el-color-success);
  color: #fff;
  box-shadow: 0 0 8px var(--accent-glow);
}

.simple-step-waiting {
  background: transparent;
  border-color: var(--text-secondary);
  color: var(--text-secondary);
}

/* 步骤标题 */
.simple-step-title {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  transition: color 0.3s;
}

.simple-step-finished + .simple-step-title {
  color: var(--accent);
}

.workflow-step-simple-item.is-active .simple-step-title{
  color: var(--el-color-success);
}

/* ==================== 箭头分隔符 ==================== */
.step-arrow-group {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 0 8px;
  flex-shrink: 0;
}

.step-arrow-chevron {
  width: 12px;
  height: 12px;
  transition: color 0.3s, opacity 0.3s;
}

/* 已完成节点后的箭头 → 高亮，无动画 */
.step-arrow-group.arrow-finished .step-arrow-chevron {
  color: var(--accent);
  opacity: 1;
}

/* 正在执行节点后的箭头 → 波浪流水动画 */
.step-arrow-group.arrow-process .step-arrow-chevron {
  color: var(--accent);
  opacity: 0.5;
  animation: arrowWaveFlow 1s ease-in-out infinite;
}

/* 未完成节点后的箭头 → 灰色，无动画 */
.step-arrow-group.arrow-waiting .step-arrow-chevron {
  color: var(--text-secondary);
  opacity: 0.3;
}

@keyframes arrowWaveFlow {
  0%, 100% {
    opacity: 0.3;
    transform: translateX(0);
  }
  50% {
    opacity: 1;
    transform: translateX(4px);
  }
}

.workflow-divider-line {
  height: 1px;
  background: var(--border-color);
  border-radius: 1px;
}

/* REC-033: header 右侧布局 */
.workflow-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workflow-task-summary-inline {
  font-size: 12px;
  color: var(--text-primary);
  opacity: 0.8;
  font-weight: 500;
}

.workflow-mode-tag {
  font-size: 11px;
}

/* REC-028: 空状态提示 */
.workflow-empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 0 18px 0;
  color: #98989d;
  font-size: 14px;
}

.workflow-empty-icon {
  color: #98989d;
  opacity: 0.6;
}

/* ==================== TASK BOARD ==================== */
.task-board-section {
  background: var(--bg-primary);
  padding: 12px var(--dashboard-inline-gutter) 18px;
}

.task-board-shell {
  width: 100%;
  max-width: none;
  margin: 0 auto;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-card);
  overflow: hidden;
}

.task-board-toggle {
  width: 100%;
  min-height: 62px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.task-board-toggle:hover {
  background: rgba(10, 132, 255, 0.06);
}

.task-board-title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.task-board-eyebrow {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 800;
}

.task-board-title strong {
  color: var(--text-primary);
  font-size: 15px;
  line-height: 1.2;
}

.task-board-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.task-board-summary span {
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
}

.task-board-arrow {
  color: var(--text-secondary);
  transition: transform 0.18s ease, color 0.18s ease;
}

.task-board-arrow.expanded {
  color: var(--accent);
  transform: rotate(90deg);
}

/* ==================== BOARD LAYOUT ==================== */
.board-container {
  width: 100%;
  max-width: none;
  margin: 0 auto;
  padding: 0 16px 16px;
  display: flex;
  gap: 14px;
  align-items: flex-start;
  overflow-x: auto;
  padding-bottom: 16px;
}

.board-column {
  flex: 1;
  min-width: 240px;
  max-width: 400px;
  background: #161617;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: visible;
  transition: border-color 0.2s;
}

.board-column:hover {
  border-color: #3a3a3c;
}

.board-column-header {
  padding: 14px 16px;
  border-bottom: 2px solid transparent;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  font-size: 13px;
}

.board-column-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 700;
  font-size: 13px;
}

.board-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
}

.board-column-tasks {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ==================== VIEW TRANSITION ==================== */
.view-fade-enter-active,
.view-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.view-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.view-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ==================== RESPONSIVE ==================== */
@media (min-width: 1680px) {
  .cockpit-card {
    padding: clamp(16px, 1vw, 24px);
  }

  .board-column {
    max-width: none;
  }
}

@media (max-width: 1280px) {
  .scope-toolbar {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .scope-toolbar-main {
    flex: 1 1 100%;
  }

  .scope-toolbar-controls {
    width: 100%;
  }

  .cockpit-inner {
    grid-template-columns: 1fr;
  }

  .cockpit-card {
    height: auto;
    min-height: 356px;
    max-height: none;
  }

  .control-dock-inner {
    gap: 8px;
  }

  .ops-summary-list {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .stat-total,
  .stat-running,
  .stat-idle,
  .stat-aborted,
  .stat-error {
    grid-column: span 1;
  }

  .stat-uptime,
  .stat-tokens,
  .stat-cost {
    grid-column: span 2;
  }

  .action-bar-inner {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1024px) {
  .agent-pulse-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .board-container {
    flex-direction: column;
  }

  .board-column {
    max-width: 100%;
  }
}

@media (max-width: 768px) {
  .status-bar-inner {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .brand {
    align-items: flex-start;
  }

  .brand-time {
    margin-left: 0;
    padding-left: 0;
    border-left: 0;
  }

  .status-indicators {
    width: 100%;
    flex-wrap: wrap;
    gap: 6px;
  }

  .cockpit-section {
    padding: 14px 14px 6px;
  }

  .cockpit-card-header {
    flex-direction: column;
  }

  .agent-pulse-summary {
    align-items: flex-start;
  }

  .control-dock-inner {
    padding: 12px 16px;
  }

  .ops-summary-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stat-number {
    font-size: 18px;
  }

  .stat-icon-wrap {
    width: 38px;
    height: 38px;
  }

  .stat-uptime,
  .stat-tokens,
  .stat-cost {
    grid-column: span 2;
  }

  .task-board-section,
  .module-card-section,
  .board-container {
    padding: 14px;
  }

  .task-board-toggle,
  .module-card-toggle {
    grid-template-columns: 1fr auto;
  }

  .task-board-summary,
  .module-card-hints {
    grid-column: 1 / -1;
    flex-wrap: wrap;
  }
}

@media (max-width: 460px) {
  .ops-summary-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .stat-total,
  .stat-running,
  .stat-idle,
  .stat-aborted,
  .stat-error,
  .stat-uptime,
  .stat-tokens,
  .stat-cost {
    grid-column: span 1;
  }
}

@media (max-width: 480px) {
  .brand-title {
    font-size: 16px;
  }

  .token-kpi-row {
    grid-template-columns: 1fr;
  }

  .control-dock-inner {
    padding: 10px 12px;
  }
}
html.light-theme .token-mini-value-label {
  stroke: #ffffff;
  stroke-width: 4px;
}
html.light-theme .token-mini-axis-label.is-token { fill: #0066d6; opacity: 1; }
html.light-theme .token-mini-axis-label.is-cost { fill: #1f9e43; opacity: 1; }
</style>

<!-- 非 scoped：通知 popper 渲染到 body，需要全局选择器 -->
<style>
.token-mini-custom-range.el-date-editor {
  width: 230px !important;
  flex: 0 0 230px;
  height: 25px !important;
  min-height: 25px !important;
  border-radius: 999px !important;
  background: rgba(255, 255, 255, 0.026) !important;
  border: 1px solid rgba(235, 235, 245, 0.10) !important;
  box-shadow: none !important;
  padding: 0 7px !important;
}

.token-mini-custom-range.el-date-editor:hover {
  border-color: rgba(10, 132, 255, 0.3) !important;
  background: rgba(255, 255, 255, 0.06) !important;
}

.token-mini-custom-range.el-date-editor.active {
  border-color: rgba(48, 209, 88, 0.28) !important;
  background: rgba(48, 209, 88, 0.065) !important;
}

.token-mini-custom-range.el-date-editor .el-range-input {
  color: var(--text-primary, #e5e5ea);
  font-size: 10px;
  font-weight: 700;
}

.token-mini-custom-range.el-date-editor .el-range-input::placeholder,
.token-mini-custom-range.el-date-editor .el-range-separator,
.token-mini-custom-range.el-date-editor .el-range__icon,
.token-mini-custom-range.el-date-editor .el-range__close-icon {
  color: var(--text-secondary, #98989d);
}

html.light-theme .dashboard {
  background: transparent;
}

html.light-theme .status-bar {
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.76), rgba(255, 255, 255, 0.48));
  border-bottom-color: rgba(60, 60, 67, 0.1);
  box-shadow: 0 10px 30px rgba(31, 35, 42, 0.07);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}

html.light-theme .brand-title {
  color: #161617;
  -webkit-text-fill-color: #161617;
}

html.light-theme .brand-version,
html.light-theme .brand-time {
  color: #6e6e73;
  -webkit-text-fill-color: #6e6e73;
}

html.light-theme .brand-time {
  border-left-color: #d1d1d6;
}

html.light-theme .top-indicator,
html.light-theme .top-layout-btn {
  background: rgba(255, 255, 255, 0.54);
  border-color: rgba(60, 60, 67, 0.1);
  color: #161617;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76), 0 6px 18px rgba(31, 35, 42, 0.04);
}

html.light-theme .top-indicator:hover,
html.light-theme .top-layout-btn:hover {
  background: rgba(255, 255, 255, 0.74);
  border-color: rgba(0, 122, 255, 0.28);
  color: #0066cc;
}

html.light-theme .top-ind-label {
  color: #8e8e93;
}

html.light-theme .top-ind-value {
  color: #161617;
}

html.light-theme .top-ind-kbd {
  background: #eef4fb;
  border-color: #d5dfeb;
  color: #6e6e73;
}

html.light-theme .top-indicator-theme .theme-icon {
  filter: saturate(1.15);
}

html.light-theme .cockpit-section,
html.light-theme .control-dock-section,
html.light-theme .task-board-section,
html.light-theme .module-card-section {
  background: transparent;
}

html.light-theme .control-dock-inner {
  background: var(--glass-card-bg);
  border-color: var(--glass-card-border);
  box-shadow: var(--glass-inner-highlight), var(--glass-shadow);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}

html.light-theme .scope-toolbar {
  background: rgba(255, 255, 255, 0.58);
  border-color: rgba(60, 60, 67, 0.11);
  box-shadow: var(--glass-inner-highlight), var(--glass-shadow);
}

html.light-theme .scope-control-group {
  background: rgba(255, 255, 255, 0.5);
  border-color: rgba(60, 60, 67, 0.08);
}

html.light-theme .token-mini-custom-range,
html.light-theme .token-mini-custom-range.el-input__wrapper,
html.light-theme .token-mini-custom-range .el-input__wrapper {
  background: rgba(255, 255, 255, 0.44) !important;
  border-color: rgba(60, 60, 67, 0.10) !important;
}

html.light-theme .token-mini-custom-range:hover,
html.light-theme .token-mini-custom-range .el-input__wrapper:hover {
  border-color: rgba(0, 122, 255, 0.26) !important;
}

html.light-theme .token-mini-custom-range.active,
html.light-theme .token-mini-custom-range.active.el-input__wrapper,
html.light-theme .token-mini-custom-range.active .el-input__wrapper {
  background: rgba(52, 199, 89, 0.065) !important;
  border-color: rgba(52, 199, 89, 0.22) !important;
}

html.light-theme .token-mini-custom-range .el-range-input {
  color: #161617;
}

html.light-theme .token-mini-custom-range .el-range-input::placeholder,
html.light-theme .token-mini-custom-range .el-range-separator,
html.light-theme .token-mini-custom-range .el-range__icon,
html.light-theme .token-mini-custom-range .el-range__close-icon {
  color: #6e6e73;
}

html.light-theme .token-mini-metrics {
  background: rgba(0, 122, 255, 0.055);
  border-color: rgba(0, 122, 255, 0.14);
}

html.light-theme .scope-control-label {
  color: #161617;
}

html.light-theme .clear-chip {
  border-color: #facc15;
  color: #854d0e;
}

html.light-theme .cockpit-card,
html.light-theme .task-board-shell,
html.light-theme .module-card-shell,
html.light-theme .stat-pill,
html.light-theme .action-btn {
  background: var(--glass-card-bg);
  border-color: var(--glass-card-border);
  box-shadow: var(--glass-inner-highlight), var(--glass-shadow);
}

html.light-theme .cockpit-card-header h2,
html.light-theme .task-board-title strong,
html.light-theme .module-card-title strong,
html.light-theme .stat-number,
html.light-theme .agent-pulse-name,
html.light-theme .model-share-token {
  color: #161617;
}

html.light-theme .cockpit-eyebrow,
html.light-theme .stat-label,
html.light-theme .token-kpi-row span,
html.light-theme .model-share-name,
html.light-theme .agent-pulse-status,
html.light-theme .task-board-eyebrow,
html.light-theme .task-board-summary,
html.light-theme .module-card-eyebrow,
html.light-theme .module-card-hints,
html.light-theme .action-label {
  color: #6e6e73;
}

html.light-theme .agent-pulse-token {
  color: #161617;
}

html.light-theme .token-mini-chip {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(60, 60, 67, 0.1);
  color: #6e6e73;
}

html.light-theme .token-mini-chip:hover {
  border-color: #6cb2ff;
  color: #0066cc;
}

html.light-theme .token-mini-chip.active {
  background: rgba(52, 199, 89, 0.12);
  border-color: rgba(52, 199, 89, 0.28);
  color: #166534;
}

html.light-theme .token-mini-chip.metric-chip.active {
  background: rgba(0, 122, 255, 0.11);
  border-color: rgba(0, 122, 255, 0.28);
  color: #0066cc;
}

html.light-theme .token-mini-chart-chip {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(60, 60, 67, 0.1);
  color: #6e6e73;
}

html.light-theme .token-mini-chart-chip:hover {
  border-color: #6cb2ff;
  color: #0066cc;
}

html.light-theme .token-mini-chart-chip.active {
  background: rgba(0, 122, 255, 0.11);
  border-color: rgba(0, 122, 255, 0.28);
  color: #0066cc;
}

html.light-theme .token-kpi-row > div,
html.light-theme .token-mini-chart,
html.light-theme .agent-pulse-item,
html.light-theme .task-board-summary span,
html.light-theme .module-card-hints > span {
  background: rgba(255, 255, 255, 0.48);
  border-color: rgba(60, 60, 67, 0.09);
}

html.light-theme .token-kpi-row strong,
html.light-theme .token-mini-chart-head strong,
html.light-theme .action-value {
  color: #161617;
}

html.light-theme .token-mini-chart-head,
html.light-theme .token-mini-axis,
html.light-theme .token-mini-chart-empty {
  color: #8e8e93;
}

html.light-theme

html.light-theme .token-mini-peak text {
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 1px;
}

html.light-theme .agent-pulse-item:hover,
html.light-theme .model-share-row:hover,
html.light-theme .task-board-toggle:hover {
  background: rgba(0, 122, 255, 0.075);
}

html.light-theme .agent-pulse-avatar,
html.light-theme .contribution-avatar {
  background: rgba(255, 255, 255, 0.64);
  border-color: rgba(60, 60, 67, 0.12);
}

html.light-theme .agent-pulse-item .agent-pulse-dot {
  border-color: #ffffff;
}

html.light-theme .contribution-line span {
  color: #161617;
}

html.light-theme .contribution-line strong {
  color: #161617;
}

html.light-theme .contribution-rank {
  color: #0066cc;
  background: rgba(0, 122, 255, 0.10);
  border-color: rgba(0, 122, 255, 0.22);
}

html.light-theme .contribution-bar {
  background: rgba(60, 60, 67, 0.12);
}

html.light-theme .model-share-row.active {
  background: rgba(0, 122, 255, 0.1);
  border-color: rgba(0, 122, 255, 0.26);
}

html.light-theme .board-column {
  background: var(--glass-card-bg);
  border-color: var(--glass-card-border);
  box-shadow: var(--glass-inner-highlight), 0 8px 20px rgba(31, 35, 42, 0.055);
}

html.light-theme .module-card-toggle:hover {
  background: rgba(0, 122, 255, 0.07);
}

html.light-theme .module-card-badge {
  background: #eef2ff;
  border-color: #c7d2fe;
  color: #4f46e5;
}

html:not(.light-theme) .control-dock-inner,
html:not(.light-theme) .cockpit-card,
html:not(.light-theme) .stat-pill,
html:not(.light-theme) .action-btn,
html:not(.light-theme) .task-board-shell,
html:not(.light-theme) .module-card-shell {
  border-color: var(--glass-card-border);
  box-shadow:
    var(--glass-inner-highlight),
    var(--glass-shadow);
}

html:not(.light-theme) .cockpit-card,
html:not(.light-theme) .stat-pill,
html:not(.light-theme) .action-btn {
  background: var(--glass-card-bg);
}

html:not(.light-theme) .token-mini-chart,
html:not(.light-theme) .token-kpi-row > div,
html:not(.light-theme) .agent-pulse-item {
  border-color: rgba(235, 235, 245, 0.12);
}

html:not(.light-theme) .model-share-row.active {
  border-color: rgba(235, 235, 245, 0.18);
}

.notif-popper {
  background: #2c2c2e !important;
  border: 1px solid var(--border-color) !important;
  padding: 0 !important;
  max-height: 480px;
  overflow: hidden;
}
.notif-panel { display: flex; flex-direction: column; max-height: 480px; }
.notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
  font-weight: 700;
  font-size: 13px;
  color: var(--text-primary);
}
.notif-actions { display: flex; gap: 4px; }
.notif-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 30px 0;
  color: var(--text-muted);
  font-size: 12px;
}
.notif-empty .el-icon { font-size: 24px; }
.notif-list {
  flex: 1;
  overflow-y: auto;
  max-height: 380px;
}
.notif-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.notif-item:hover,
.notif-item:focus-visible { background: var(--fill-subtle); outline: none; }
.notif-item.unread { background: rgba(10, 132, 255,0.06); }
.notif-error.unread { background: rgba(255, 69, 58,0.08); }
.notif-icon { font-size: 16px; flex-shrink: 0; }
.notif-body { flex: 1; min-width: 0; }
.notif-agent { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.notif-msg { font-size: 12px; color: var(--text-secondary); margin-top: 2px; line-height: 1.4; word-break: break-word; }
.notif-time { font-size: 10px; color: var(--text-muted); margin-top: 4px; }
.notif-open-hint {
  flex: 0 0 auto;
  color: #6cb2ff;
  font-size: 10px;
  opacity: 0;
  transition: opacity 0.15s;
}
.notif-item:hover .notif-open-hint,
.notif-item:focus-visible .notif-open-hint { opacity: 1; }
</style>
