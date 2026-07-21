<template>
  <el-dialog
    top="4vh"
    v-model="visible"
    :title="dialogTitle"
    width="min(1180px, 94vw)"
    :close-on-click-modal="true"
    class="token-detail-dialog"
  >
    <div class="detail-metric-bar">
      <div class="detail-range-controls">
        <el-date-picker
          v-model="chartCustomRangeDraft"
          class="chart-custom-range"
          :class="{ active: chartRange === 'custom' }"
          type="daterange"
          unlink-panels
          clearable
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="起始日期"
          end-placeholder="截止日期"
          size="small"
          :disabled="chartLoading"
          @change="setChartCustomRange"
        />
        <div class="detail-range-quick">
          <button
            v-for="opt in CHART_RANGES"
            :key="opt.value"
            class="range-btn"
            :class="{ active: chartRange === opt.value }"
            :disabled="chartLoading"
            @click="setChartRange(opt.value)"
          >{{ opt.label }}</button>
        </div>
      </div>
      <div class="detail-metric-right">
        <span class="detail-metric-label">消耗类型：</span>
        <div class="top-metric-switch" aria-label="查看指标">
          <button class="metric-switch-btn" :class="{ active: chartMetric === 'both' }" :disabled="chartLoading" type="button" @click="chartMetric = 'both'">全部</button>
          <button class="metric-switch-btn" :class="{ active: chartMetric === 'tokens' }" :disabled="chartLoading" type="button" @click="chartMetric = 'tokens'">Token</button>
          <button class="metric-switch-btn" :class="{ active: chartMetric === 'cost' }" :disabled="chartLoading" type="button" @click="chartMetric = 'cost'">API 等价费用</button>
        </div>
      </div>
    </div>

    <div v-if="projectScope" class="project-scope-banner" data-testid="project-scope-banner">
      <div>
        <strong>已限定当前项目</strong>
        <span>{{ projectScope.appName }} · {{ projectScope.projectName }}</span>
      </div>
      <div class="project-scope-actions">
        <span>{{ projectScope.sources.length }} 个会话</span>
        <el-button size="small" type="primary" plain @click="emit('view-execution', projectScope)">查看执行记录</el-button>
      </div>
    </div>

    <div class="api-summary-grid" v-if="timeline.length > 0">
      <div class="api-summary-card api-summary-card--cost">
        <span>API 总价</span>
        <strong>{{ formatPeriodCost(timelineTotals) }}</strong>
      </div>
      <div class="api-summary-card api-summary-card--token">
        <span>总 Token</span>
        <strong>{{ formatTokenZh(totalTokens) }}</strong>
      </div>
      <div class="api-summary-card">
        <span>缓存命中率</span>
        <strong>{{ cacheHitRateText }}</strong>
      </div>
      <div class="api-summary-card">
        <span>无缓存等价费用</span>
        <strong>{{ formatStandaloneCost(noCacheCost) }}</strong>
      </div>
    </div>

    <div class="section client-breakdown" v-if="timeline.length > 0">
      <div class="section-title client-breakdown-title">
        <el-icon><Monitor /></el-icon>
        客户端
        <button
          class="client-all-btn"
          :class="{ active: clientFilter === 'all' }"
          type="button"
          @click="clientFilter = 'all'"
        >全部</button>
      </div>
      <div class="client-card-grid">
        <button
          v-for="client in clientRows"
          :key="client.id"
          class="client-card"
          :class="{ active: clientFilter === client.id }"
          type="button"
          @click="clientFilter = client.id"
        >
          <span class="client-card-name">{{ client.name }}</span>
          <strong>{{ formatTokenZh(client.usage.tokens) }}</strong>
          <span>{{ formatStandaloneCost(client.usage.cost) }}</span>
          <span class="client-card-share">费用占比 {{ client.pct }}%</span>
        </button>
      </div>
    </div>

    <!-- 模型筛选 -->
    <div class="chart-range-bar">
      <div class="range-model-filter">
        <span class="range-model-label">模型：</span>
        <el-select
          v-model="modelFilter"
          multiple
          collapse-tags
          collapse-tags-tooltip
          clearable
          placeholder="全部模型"
          size="small"
          class="range-model-select"
          :teleported="false"
          :disabled="chartLoading"
        >
          <el-option
            v-for="opt in modelFilterOptions"
            :key="opt.value"
            :label="opt.text"
            :value="opt.value"
          >
            <div class="model-option-row">
              <span
                class="model-logo model-logo--small model-option-logo"
                :class="`model-logo--${getModelLogoKey(opt.value)}`"
                :title="getModelCompanyName(opt.value)"
              >
                <img
                  v-if="getModelLogoSrc(opt.value)"
                  class="model-logo-img"
                  :src="getModelLogoSrc(opt.value)"
                  :alt="getModelCompanyName(opt.value)"
                />
                <span v-else>{{ getModelLogoText(opt.value) }}</span>
              </span>
              <span class="model-option-name">{{ opt.text }}</span>
            </div>
          </el-option>
        </el-select>
      </div>
    </div>

    <!-- Token / 成本折线图（Sprint 6 + 全量范围）-->
    <div class="section chart-section">
      <div class="section-title">
        <el-icon><TrendCharts /></el-icon>
        {{ chartRangeTitle }} Token / API 等价费用趋势
        <span class="section-hint">{{ chartAggregationHint }} · {{ modelScopeHint }}</span>
        <div class="chart-compare">
          <span class="compare-item" :class="weeklyChangePercent >= 0 ? 'up' : 'down'">
            周同比 {{ weeklyChangePercent >= 0 ? '▲' : '▼' }} {{ Math.abs(weeklyChangePercent) }}%
          </span>
          <span class="compare-item" :class="monthOverMonth >= 0 ? 'up' : 'down'">
            月同比 {{ monthOverMonth >= 0 ? '▲' : '▼' }} {{ Math.abs(monthOverMonth) }}%
          </span>
        </div>
      </div>
      <div
        class="cost-chart"
        v-loading="chartLoading"
        @mousemove="handleChartMouseMove"
        @mouseleave="clearChartHover"
      >
        <div class="chart-plot" ref="detailPlotEl" v-if="costChartPoints.length > 1 || tokenChartPoints.length > 1">
        <svg class="chart-svg" :viewBox="`0 0 ${SVG_W} ${SVG_H}`" preserveAspectRatio="none">
          <!-- 网格线 -->
          <line v-for="y in gridLines" :key="y" :x1="PAD_L" :y1="y" :x2="SVG_W - PAD_R" :y2="y"
            stroke="var(--chart-grid-line)" stroke-width="1" />
          <!-- 填充区域：Token + 成本分别归一化 -->
          <path v-if="chartMetric !== 'cost'" :d="tokenAreaPath" fill="url(#tokenChartGradient)" opacity="0.25" />
          <path v-if="chartMetric !== 'tokens'" :d="costAreaPath" fill="url(#costChartGradient)" opacity="0.3" />
          <!-- 折线 -->
          <path v-if="chartMetric !== 'cost'" :d="tokenLinePath" fill="none" stroke="#0a84ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          <path v-if="chartMetric !== 'tokens'" :d="costLinePath" fill="none" stroke="#30d158" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <!-- 渐变定义 -->
          <defs>
            <linearGradient id="tokenChartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#0a84ff" stop-opacity="0.42"/>
              <stop offset="100%" stop-color="#0a84ff" stop-opacity="0"/>
            </linearGradient>
            <linearGradient id="costChartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#30d158" stop-opacity="0.4"/>
              <stop offset="100%" stop-color="#30d158" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <!-- 数据点 -->
          <circle
            v-for="(pt, i) in tokenChartPoints"
            v-show="showChartDots && chartMetric !== 'cost'"
            :key="`token-${i}`"
            :cx="pt.x" :cy="pt.y" r="3"
            fill="#0a84ff"
            stroke="var(--chart-dot-stroke)"
            stroke-width="1.5"
          >
            <title>{{ pt.date }}: {{ formatTokenZhWithRaw(pt.tokens) }}</title>
          </circle>
          <circle
            v-for="(pt, i) in costChartPoints"
            v-show="showChartDots && chartMetric !== 'tokens'"
            :key="`cost-${i}`"
            :cx="pt.x" :cy="pt.y" r="3"
            fill="#30d158"
            stroke="var(--chart-dot-stroke)"
            stroke-width="1.5"
          >
            <title>{{ pt.date }}: ¥{{ pt.cost.toFixed(4) }}</title>
          </circle>
          <!-- X轴标签（每5天一个） -->
          <template v-for="(pt, i) in costChartPoints" :key="`lbl-${i}`">
            <text
              v-if="i % xLabelInterval === 0 || i === costChartPoints.length - 1"
              :x="pt.x" :y="SVG_H - 4"
              text-anchor="middle"
              font-size="10.5" fill="var(--chart-axis-label)"
            >{{ pt.label }}</text>
          </template>
          <!-- Y轴整数刻度: 左Token/右费用 -->
          <template v-for="tick in detailAxisTicks" :key="`yt-${tick.f}`">
            <text v-if="chartMetric !== 'cost'" :x="PAD_L - 6" :y="tick.y + 3.5" text-anchor="end" class="chart-tick chart-tick--token">{{ tick.tokenText }}</text>
            <text v-if="chartMetric === 'both'" :x="SVG_W - 4" :y="tick.y + 3.5" text-anchor="end" class="chart-tick chart-tick--cost">{{ tick.costText }}</text>
            <text v-if="chartMetric === 'cost'" :x="PAD_L - 6" :y="tick.y + 3.5" text-anchor="end" class="chart-tick chart-tick--cost">{{ tick.costText }}</text>
          </template>
          <!-- 常显数值标签 -->
          <text
            v-for="(vl, vi) in detailValueLabels"
            :key="`vl-${vi}`"
            class="chart-value-label"
            :x="vl.x" :y="vl.y" :fill="vl.color" :text-anchor="vl.anchor"
          >{{ vl.label }}</text>
          <!-- 悬浮辅助线与高亮点 -->
          <g v-if="hoveredChartPoint">
            <line
              :x1="hoveredChartPoint.x"
              :y1="PAD_T"
              :x2="hoveredChartPoint.x"
              :y2="SVG_H - PAD_B"
              stroke="var(--chart-hover-line)"
              stroke-width="1"
              stroke-dasharray="3 3"
            />
            <circle
              v-if="chartMetric !== 'cost'"
              :cx="hoveredChartPoint.x"
              :cy="hoveredChartPoint.tokenY"
              r="5"
              fill="#0a84ff"
              stroke="var(--chart-dot-stroke)"
              stroke-width="2"
            />
            <circle
              v-if="chartMetric !== 'tokens'"
              :cx="hoveredChartPoint.x"
              :cy="hoveredChartPoint.costY"
              r="5"
              fill="#30d158"
              stroke="var(--chart-dot-stroke)"
              stroke-width="2"
            />
          </g>
        </svg>
        </div>
        <div v-if="hoveredChartPoint" class="chart-tooltip" :style="chartTooltipStyle">
          <div class="tooltip-date">{{ hoveredChartPoint.date }}</div>
          <div v-if="chartMetric !== 'cost'" class="tooltip-row token-row">
            <span>Token</span>
            <strong>{{ formatTokenZhWithRaw(hoveredChartPoint.tokens) }}</strong>
          </div>
          <div v-if="chartMetric !== 'tokens'" class="tooltip-row cost-row">
            <span>API 等价费用</span>
            <strong>{{ formatCostDetail(hoveredChartPoint.cost, hoveredChartPoint.priceStatus, hoveredChartPoint.billingMode) }}</strong>
          </div>
        </div>
        <div v-if="!chartLoading && !(costChartPoints.length > 1 || tokenChartPoints.length > 1)" class="chart-empty">暂无趋势数据</div>
      </div>
      <!-- 峰值日 -->
      <div v-if="peakDay" class="chart-peak">
        {{ peakLabel }}
      </div>
    </div>

    <!-- 全局按模型汇总 -->
    <div class="section" v-loading="chartLoading">
      <div class="section-title">
        <el-icon><Odometer /></el-icon>
        消耗汇总（按模型）
        <span class="section-hint">{{ tableScopeHint }}</span>
      </div>
      <el-table :data="modelRows" stripe size="small" class="model-table">
        <el-table-column type="expand" width="44">
          <template #default="{ row }">
            <div class="model-cost-breakdown">
              <div><span>非缓存输入</span><strong>{{ formatTokenZh(row.input) }}</strong></div>
              <div><span>缓存输入</span><strong>{{ formatTokenZh(row.cacheTokens) }}</strong></div>
              <div><span>输出</span><strong>{{ formatTokenZh(row.output) }}</strong></div>
              <div><span>输入费用</span><strong>{{ formatStandaloneCost(row.inputCost) }}</strong></div>
              <div><span>缓存输入费用</span><strong>{{ formatStandaloneCost(row.cacheCost) }}</strong></div>
              <div><span>输出费用</span><strong>{{ formatStandaloneCost(row.outputCost) }}</strong></div>
              <div><span>长上下文费用</span><strong>{{ formatStandaloneCost(row.longContextCost) }}</strong></div>
              <div class="model-cost-breakdown-total"><span>API 总价</span><strong>{{ formatStandaloneCost(row.cost) }}</strong></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="模型" min-width="240">
          <template #default="{ row }">
            <div class="model-cell">
              <span
                class="model-logo"
                :class="`model-logo--${getModelLogoKey(row.model)}`"
                :title="getModelCompanyName(row.model)"
              >
                <img
                  v-if="getModelLogoSrc(row.model)"
                  class="model-logo-img"
                  :src="getModelLogoSrc(row.model)"
                  :alt="getModelCompanyName(row.model)"
                />
                <span v-else>{{ getModelLogoText(row.model) }}</span>
              </span>
              <span class="model-name">{{ row.displayName }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Token 用量" align="right" min-width="138">
          <template #default="{ row }">
            <span class="token-num" :title="formatTokenRaw(row.tokens)">{{ formatTokenZh(row.tokens) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="API 总价" prop="cost" align="right" min-width="150">
          <template #default="{ row }">
            <span :class="row.cost > 0 ? 'cost-num' : 'cost-zero'">
              {{ formatStandaloneCost(row.cost) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="费用占比" align="right" min-width="176">
          <template #default="{ row }">
            <div class="pct-cell">
              <span class="pct-num">{{ row.pct }}%</span>
              <span class="pct-track">
                <span class="pct-fill" :style="{ width: `${row.pct}%`, background: row.color }"></span>
              </span>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 总计行 -->
      <div class="total-row" data-testid="token-detail-total">
        <span class="total-label">合计</span>
        <span class="total-tokens">{{ formatTokenZhWithRaw(modelTableTotalTokens) }}</span>
        <span class="total-cost">{{ formatStandaloneCost(modelTableTotalCost) }}</span>
      </div>
    </div>

    <!-- 各 Agent 明细 -->
    <div class="section" style="margin-top: 20px;" v-loading="chartLoading">
      <div class="section-title">
        <el-icon><UserFilled /></el-icon>
        各来源明细
        <span class="section-hint">（可筛选 + 表头排序）</span>
      </div>

      <!-- 筛选条 -->
      <div class="filter-bar">
        <div class="filter-item">
          <span class="filter-label">{{ projectScope ? '会话：' : '来源：' }}</span>
          <el-select
            v-model="agentFilter"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            :placeholder="projectScope ? '当前项目全部会话' : '全部来源'"
            size="small"
            class="filter-select"
            :teleported="false"
          >
            <el-option
              v-for="opt in agentFilterOptions"
              :key="opt.value"
              :label="opt.text"
              :value="opt.value"
            />
          </el-select>
        </div>
        <div class="filter-item">
          <span class="filter-label">模型：</span>
          <el-select
            v-model="modelFilter"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="全部模型"
            size="small"
            class="filter-select"
            :teleported="false"
          >
            <el-option
              v-for="opt in modelFilterOptions"
              :key="opt.value"
              :label="opt.text"
              :value="opt.value"
            >
              <div class="model-option-row">
                <span
                  class="model-logo model-logo--small model-option-logo"
                  :class="`model-logo--${getModelLogoKey(opt.value)}`"
                  :title="getModelCompanyName(opt.value)"
                >
                  <img
                    v-if="getModelLogoSrc(opt.value)"
                    class="model-logo-img"
                    :src="getModelLogoSrc(opt.value)"
                    :alt="getModelCompanyName(opt.value)"
                  />
                  <span v-else>{{ getModelLogoText(opt.value) }}</span>
                </span>
                <span class="model-option-name">{{ opt.text }}</span>
              </div>
            </el-option>
          </el-select>
        </div>
        <span class="filter-count">{{ filteredAgentModelRows.length }} / {{ agentModelRows.length }} 条</span>
      </div>

      <el-table
        :data="filteredAgentModelRows"
        stripe
        size="small"
        class="agent-table"
        :default-sort="{ prop: activeMetricProp, order: 'descending' }"
      >
        <el-table-column
          label="来源"
          prop="agentId"
          min-width="150"
          sortable
          :sort-method="sortAgentRows"
        >
          <template #default="{ row }">
            <div class="agent-cell">
              <span class="agent-avatar-sm">
                <img
                  v-if="getAgentAvatarSrc(row.agentId) && !avatarFailed[row.agentId]"
                  :src="getAgentAvatarSrc(row.agentId)"
                  :alt="row.agentName"
                  class="agent-avatar-img"
                  @error="handleAgentAvatarError(row.agentId, $event)"
                />
                <span v-else-if="row.emoji" class="agent-avatar-emoji">{{ row.emoji }}</span>
                <span v-else class="agent-avatar-letter">{{ row.agentId[0].toUpperCase() }}</span>
              </span>
              <span class="agent-id-name">{{ row.agentName }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="模型"
          prop="model"
          min-width="220"
          sortable
          :sort-method="sortModelRows"
        >
          <template #default="{ row }">
            <div class="model-cell">
              <span
                class="model-logo model-logo--small"
                :class="`model-logo--${getModelLogoKey(row.model)}`"
                :title="getModelCompanyName(row.model)"
              >
                <img
                  v-if="getModelLogoSrc(row.model)"
                  class="model-logo-img"
                  :src="getModelLogoSrc(row.model)"
                  :alt="getModelCompanyName(row.model)"
                />
                <span v-else>{{ getModelLogoText(row.model) }}</span>
              </span>
              <span :title="getModelDisplayName(row.model)">{{ getModelDisplayName(row.model) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          v-if="chartMetric !== 'cost'"
          label="Token 用量"
          prop="tokens"
          align="right"
          min-width="118"
          sortable
          :sort-method="(a: any, b: any) => a.tokens - b.tokens"
        >
          <template #default="{ row }">
            <span class="token-num" :title="formatTokenRaw(row.tokens)">{{ formatTokenZh(row.tokens) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          v-if="chartMetric !== 'cost'"
          label="输入"
          prop="input"
          align="right"
          min-width="98"
          sortable
          :sort-method="(a: any, b: any) => a.input - b.input"
        >
          <template #default="{ row }">
            <span class="token-split-num" :title="formatTokenRaw(row.input)">{{ formatTokenZh(row.input) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          v-if="chartMetric !== 'cost'"
          label="输出"
          prop="output"
          align="right"
          min-width="98"
          sortable
          :sort-method="(a: any, b: any) => a.output - b.output"
        >
          <template #default="{ row }">
            <span class="token-split-num" :title="formatTokenRaw(row.output)">{{ formatTokenZh(row.output) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          v-if="chartMetric !== 'cost'"
          label="缓存"
          prop="cacheTokens"
          align="right"
          min-width="98"
          sortable
          :sort-method="(a: any, b: any) => a.cacheTokens - b.cacheTokens"
        >
          <template #default="{ row }">
            <span class="token-split-num" :title="formatTokenRaw(row.cacheTokens)">{{ formatTokenZh(row.cacheTokens) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          v-if="chartMetric !== 'tokens'"
          label="API 等价总费用"
          prop="cost"
          align="right"
          min-width="124"
          sortable
          :sort-method="(a: any, b: any) => a.cost - b.cost"
        >
          <template #default="{ row }">
            <span :class="row.cost > 0 ? 'cost-num' : 'cost-zero'">
              {{ formatCostDetail(row.cost, row.priceStatus, row.billingMode) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column
          v-if="chartMetric === 'cost'"
          label="输入等价费用"
          prop="inputCost"
          align="right"
          min-width="124"
          sortable
          :sort-method="(a: any, b: any) => a.inputCost - b.inputCost"
        >
          <template #default="{ row }">
            <span :class="row.inputCost > 0 ? 'cost-num' : 'cost-zero'">
              {{ formatCostDetail(row.inputCost, row.priceStatus, row.billingMode) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column
          v-if="chartMetric === 'cost'"
          label="输出等价费用"
          prop="outputCost"
          align="right"
          min-width="124"
          sortable
          :sort-method="(a: any, b: any) => a.outputCost - b.outputCost"
        >
          <template #default="{ row }">
            <span :class="row.outputCost > 0 ? 'cost-num' : 'cost-zero'">
              {{ formatCostDetail(row.outputCost, row.priceStatus, row.billingMode) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column
          v-if="chartMetric === 'cost'"
          label="缓存等价费用"
          prop="cacheCost"
          align="right"
          min-width="132"
          sortable
          :sort-method="(a: any, b: any) => a.cacheCost - b.cacheCost"
        >
          <template #default="{ row }">
            <span :class="row.cacheCost > 0 ? 'cost-num' : 'cost-zero'">
              {{ formatCostDetail(row.cacheCost, row.priceStatus, row.billingMode) }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <span class="updated-at">数据更新：{{ timelineUpdatedAt || (store.globalUsage.updatedAt ? new Date(store.globalUsage.updatedAt).toLocaleString('zh-CN') : '-') }}</span>
        <el-button @click="visible = false">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { Monitor, Odometer, UserFilled, TrendCharts } from '@element-plus/icons-vue'
import { useAgentStore } from '../stores/agent'
import { formatTokenRaw, formatTokenZh, formatTokenZhWithRaw } from '../utils/tokenFormat'
import {
  isLocalUsageSourceId,
  localUsageSourceAppId,
  localUsageSourceAvatarSrc,
  localUsageSourceDisplayName,
  mergeUsageTimelines,
  type AgentModelUsageMap,
  type ModelUsageMap,
  type TimelineDay,
  type UsageDatum,
} from '../utils/usageTimeline'
import { createSafeRecord, ownValue, safeRecordFrom } from '../utils/safe-record.mjs'
import { filterTimelineBySourceIds } from '../utils/project-token-scope.mjs'
import { normalizeAgentAvatarSource } from '../utils/agent-presentation.mjs'
import type { ProjectTokenScope } from '../types/project-token-scope'

const visible = defineModel<boolean>('visible', { default: false })
const props = defineProps<{
  sourceFilter?: string | null
  projectScope?: ProjectTokenScope | null
}>()
const emit = defineEmits<{
  (event: 'view-execution', scope: ProjectTokenScope): void
}>()

const store = useAgentStore()
const projectScope = computed(() => props.projectScope || null)
const dialogTitle = computed(() => (
  projectScope.value
    ? `${projectScope.value.appName} · ${projectScope.value.projectName} Token 明细`
    : 'Token 消耗详情'
))

// 打开 dialog 时拉一次最新费用速览 + 图表数据
watch(visible, (val) => {
  if (val) {
    store.fetchCostSummary()
    fetchTimeline(true)
  }
})

// ── Sprint 6 + Sprint 8: 费用时间线图表 ──
const chartLoading = ref(false)
const timeline = ref<TimelineDay[]>([])
const timelineUpdatedAt = ref('')
const timelineErrorNotified = ref(false)

// Sprint 8: 图表时间范围选择
type ChartRangeValue = 'today' | '3d' | '7d' | '30d' | 'month' | 'lastMonth' | 'all' | 'custom'
type ChartMetric = 'both' | 'tokens' | 'cost'
const CHART_RANGES: Array<{ value: ChartRangeValue; label: string }> = [
  { value: 'today', label: '今天' },
  { value: '3d', label: '3 天' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'month', label: '本月' },
  { value: 'lastMonth', label: '上个月' },
  { value: 'all', label: '全部' },
]
const DEFAULT_CHART_RANGE: ChartRangeValue = 'today'
const chartRange = ref<ChartRangeValue>(DEFAULT_CHART_RANGE)
const chartCustomRange = ref<[string, string] | null>(null)
const chartCustomRangeDraft = ref<string[]>([])
const chartMetric = ref<ChartMetric>('both')
type ClientFilter = 'all' | 'openclaw' | 'codex' | 'claude-code'
const clientFilter = ref<ClientFilter>('all')
const modelFilter = ref<string[]>([])
const agentFilter = ref<string[]>([])
const hoveredChartIndex = ref<number | null>(null)
const timelineRequestId = ref(0)

function setChartRange(value: ChartRangeValue) {
  chartRange.value = value
  clearChartHover()
  fetchTimeline(true)
}
function setChartCustomRange(value: string[] | null) {
  const n = normalizeDateRange(value)
  if (!n) {
    chartCustomRange.value = null
    chartCustomRangeDraft.value = []
    if (chartRange.value === 'custom') setChartRange(DEFAULT_CHART_RANGE)
    return
  }
  chartCustomRange.value = n
  chartCustomRangeDraft.value = [...n]
  chartRange.value = 'custom'
  clearChartHover()
  fetchTimeline(true)
}

const chartRangeTitle = computed(() => {
  if (chartRange.value === 'custom') return '自选范围'
  return CHART_RANGES.find((r) => r.value === chartRange.value)?.label || '近期'
})
const chartAggregationHint = computed(() => chartRange.value === 'today' ? '按小时聚合' : '按天聚合')

watch([chartMetric, modelFilter], () => clearChartHover())

// SVG 尺寸
// 画布=容器真实像素(1:1渲染,文字图形不变形)
const SVG_W = ref(700)
const SVG_H = ref(200)
const detailPlotEl = ref<HTMLElement | null>(null)
// RO 必须在 watch 首次触发前就绪(watch 先于 onMounted 执行)
const detailRO: ResizeObserver | null = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver((es) => {
      for (const e of es) {
        const w = Math.round(e.contentRect.width); const h = Math.round(e.contentRect.height)
        if (w > 80) SVG_W.value = w
        if (h > 60) SVG_H.value = h
      }
    })
  : null
function syncDetailSize(): void {
  const el = detailPlotEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  if (r.width > 80) SVG_W.value = Math.round(r.width)
  if (r.height > 60) SVG_H.value = Math.round(r.height)
}
watch(detailPlotEl, (el, old) => {
  if (old && detailRO) detailRO.unobserve(old)
  if (el && detailRO) detailRO.observe(el)
  if (el) { setTimeout(syncDetailSize, 0); setTimeout(syncDetailSize, 250) }
})
onMounted(() => {
  window.addEventListener('resize', syncDetailSize)
  setTimeout(syncDetailSize, 0)
  setTimeout(syncDetailSize, 300)
})
onUnmounted(() => {
  detailRO?.disconnect()
  window.removeEventListener('resize', syncDetailSize)
})

const PAD_T = 16
const PAD_B = 22
// 标签宽度估算(CJK/¥/数字)
function estLabelW(t: string): number {
  let w = 0
  for (const ch of t) w += /[亿万千]/.test(ch) ? 11 : ch === '¥' ? 7 : 6
  return w
}
// 左轴边距:按当前左轴标签宽度动态收缩
const PAD_L = computed(() => {
  const labels = detailAxisTicks.value.map((t) => (chartMetric.value === 'cost' ? t.costText : t.tokenText))
  const maxW = labels.length ? Math.max(...labels.map(estLabelW)) : 20
  return Math.min(58, Math.max(26, Math.round(maxW + 10)))
})
// 右轴边距:双指标时按右轴(费用)标签宽度收窄,让折线贴近右侧
const PAD_R = computed(() => {
  if (chartMetric.value !== 'both') return 14
  const labels = detailAxisTicks.value.map((t) => t.costText)
  const maxW = labels.length ? Math.max(...labels.map(estLabelW)) : 28
  return Math.min(54, Math.max(20, Math.round(maxW + 8)))
})

// 紧贴峰值的整洁刻度:max 恰好罩住峰值,刻度为 step 整数倍
function niceScaleOf(raw: number, tickTarget = 4): { step: number; max: number; ticks: number[] } {
  if (raw <= 0) return { step: 1, max: 1, ticks: [0, 1] }
  const rawStep = raw / tickTarget
  const exp = Math.floor(Math.log10(rawStep))
  const base = Math.pow(10, exp)
  const m = rawStep / base
  const niceM = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10
  const step = niceM * base
  const max = Math.ceil(raw / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 1e-6; v += step) ticks.push(v)
  return { step, max, ticks }
}
const detailScale = computed(() => ({
  tokens: niceScaleOf(chartMaxTokens.value || 1),
  cost: niceScaleOf(chartMaxCost.value || 1),
}))
// 主指标决定网格线:双指标用 token,成本单独看用 cost
const detailAxisTicks = computed(() => {
  const plotH = SVG_H.value - PAD_T - PAD_B
  const isCostOnly = chartMetric.value === 'cost'
  const primary = isCostOnly ? detailScale.value.cost : detailScale.value.tokens
  const cs = detailScale.value.cost
  return primary.ticks.map((v) => {
    const f = primary.max ? v / primary.max : 0
    return {
      f,
      y: PAD_T + plotH * (1 - f),
      tokenText: v === 0 ? '0' : formatTokenZh(v),
      costText: isCostOnly ? `¥${Math.round(v)}` : `¥${Math.round(cs.max * f)}`,
    }
  })
})

// 常显数值标签:贪心防撞,Token在线上方/费用在线下方
const detailValueLabels = computed(() => {
  // 数值标签:避让其他标签 + 折线本身,放不下舍弃
  type L = { x: number; y: number; label: string; color: string; anchor: string }
  const out: L[] = []
  const W = SVG_W.value
  const H = SVG_H.value
  const PR = PAD_R.value
  const LH = 11
  const seriesDefs: Array<{ pts: ChartPoint[]; above: boolean; color: string; fmt: (p: ChartPoint) => string }> = []
  if (chartMetric.value !== 'cost') seriesDefs.push({ pts: tokenChartPoints.value, above: true, color: '#0a84ff', fmt: (pt) => formatTokenZh(pt.tokens) })
  if (chartMetric.value !== 'tokens') seriesDefs.push({ pts: costChartPoints.value, above: false, color: '#30d158', fmt: (pt) => `¥${pt.cost >= 100 ? Math.round(pt.cost) : pt.cost.toFixed(1)}` })

  const allPts = seriesDefs.map((d) => d.pts)
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
            if (xq >= Math.min(a.x, b.x) && xq <= Math.max(a.x, b.x)) ys.push(a.y + ((b.y - a.y) * (xq - a.x)) / (b.x - a.x))
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

  for (const def of seriesDefs) {
    const pts = def.pts
    if (pts.length < 2) continue
    const vals = pts.map((pt) => (def.above ? pt.tokens : pt.cost))
    const maxIdx = vals.indexOf(Math.max(...vals))
    const order: number[] = [maxIdx, 0, pts.length - 1]
    for (let k = 1; k < pts.length - 1; k++) if (k !== maxIdx) order.push(k)
    const done = new Set<number>()
    for (const idx of order) {
      if (done.has(idx)) continue
      const pt = pts[idx]
      const zv = def.above ? pt.tokens : pt.cost
      if (zv <= 0 && idx !== maxIdx) continue
      const label = def.fmt(pt)
      const w = label.length * 6.2 + 8
      let anchor = 'middle'; let cx0 = pt.x - w / 2
      if (pt.x < PAD_L.value + 14) { anchor = 'start'; cx0 = pt.x - 2 }
      else if (pt.x > W - PR - 14) { anchor = 'end'; cx0 = pt.x - w + 2 }
      const cx1 = cx0 + w
      const tryYs = def.above ? [pt.y - 9, pt.y + 12] : [pt.y + 12, pt.y - 9]
      for (const baseY of tryYs) {
        const labelY = Math.min(H - PAD_B - 1, Math.max(LH, baseY))
        const box = { x0: cx0, y0: labelY - LH, x1: cx1, y1: labelY + 1 }
        if (box.y0 < 1 || box.y1 > H - PAD_B + 1) continue
        if (hits(box)) continue
        placed.push(box)
        done.add(idx)
        out.push({ x: pt.x, y: labelY, label, color: def.color, anchor })
        break
      }
    }
  }
  return out
})

function localUsageQueryForChart(): string {
  const today = startOfLocalDay(new Date())
  const makeRange = (start: Date, end: Date = today) => (
    `start=${encodeURIComponent(formatDateKey(start))}&end=${encodeURIComponent(formatDateKey(end))}`
  )

  if (chartRange.value === 'today') return `${makeRange(today)}&granularity=hour`
  if (chartRange.value === '3d') return 'days=3'
  if (chartRange.value === '7d') return 'days=7'
  if (chartRange.value === 'month') return makeRange(new Date(today.getFullYear(), today.getMonth(), 1))
  if (chartRange.value === 'lastMonth') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const end = new Date(today.getFullYear(), today.getMonth(), 0)
    return makeRange(start, end)
  }
  if (chartRange.value === 'custom' && chartCustomRange.value) {
    return `start=${encodeURIComponent(chartCustomRange.value[0])}&end=${encodeURIComponent(chartCustomRange.value[1])}`
  }
  return 'days=all'
}

async function fetchTimeline(clearExisting = false) {
  const requestId = timelineRequestId.value + 1
  timelineRequestId.value = requestId
  chartLoading.value = true
  clearChartHover()
  void clearExisting
  try {
    const range = chartRequestDays(chartRange.value)
    const granularityQuery = chartRange.value === 'today' ? '&granularity=hour' : ''
    const [openclawResult, localResult] = await Promise.allSettled([
      fetch(`/api/cost-timeline?days=${encodeURIComponent(String(range))}${granularityQuery}`),
      fetch(`/api/local-ai-usage?${localUsageQueryForChart()}`),
    ])
    if (openclawResult.status === 'rejected' || localResult.status === 'rejected') {
      throw new Error('费用明细加载失败')
    }
    const openclawData = await openclawResult.value.json().catch(() => ({}))
    const localData = await localResult.value.json().catch(() => ({}))
    if (!openclawResult.value.ok || !localResult.value.ok || openclawData.error || localData.error) {
      throw new Error(openclawData.error || localData.error || '费用明细加载失败')
    }
    if (requestId !== timelineRequestId.value) return
    timeline.value = mergeUsageTimelines(
      Array.isArray(openclawData.timeline) ? openclawData.timeline : [],
      Array.isArray(localData.timeline) ? localData.timeline : [],
    ) as TimelineDay[]
    timelineUpdatedAt.value = new Date().toLocaleString('zh-CN')
    timelineErrorNotified.value = false
    clearChartHover()
  } catch (error) {
    if (requestId !== timelineRequestId.value || timelineErrorNotified.value) return
    timelineErrorNotified.value = true
    store.addNotification({
      type: 'error',
      agentId: 'usage-summary',
      agentName: '费用统计',
      message: error instanceof Error ? error.message : '费用明细加载失败',
      source: 'Token 消耗详情',
      detail: '费用明细的时间线请求未能成功完成。',
      errorCode: 'usage_detail_load_failed',
      impact: `${chartRangeTitle.value}范围的明细图表未更新。`,
      currentResult: timeline.value.length > 0
        ? '弹窗继续显示上一份已经完成的明细数据。'
        : '当前没有可以显示的费用明细数据。',
      timeRange: chartRangeTitle.value,
    })
  } finally {
    if (requestId === timelineRequestId.value) chartLoading.value = false
  }
}

const selectedModelSet = computed(() => new Set(modelFilter.value))
const hasModelFilter = computed(() => selectedModelSet.value.size > 0)

function isModelSelected(model: string): boolean {
  return !hasModelFilter.value || selectedModelSet.value.has(model)
}

function cloneUsage(usage: Partial<UsageDatum> | undefined): UsageDatum {
  return {
    tokens: Number(usage?.tokens) || 0,
    cost: Number(usage?.cost) || 0,
    input: Number(usage?.input) || 0,
    output: Number(usage?.output) || 0,
    cacheRead: Number(usage?.cacheRead) || 0,
    cacheWrite: Number(usage?.cacheWrite) || 0,
    inputCost: Number(usage?.inputCost) || 0,
    outputCost: Number(usage?.outputCost) || 0,
    cacheReadCost: Number(usage?.cacheReadCost) || 0,
    cacheWriteCost: Number(usage?.cacheWriteCost) || 0,
    longContextCost: Number(usage?.longContextCost) || 0,
    noCacheCost: Number(usage?.noCacheCost) || 0,
    priceStatus: usage?.priceStatus,
    billingMode: usage?.billingMode,
  }
}

function emptyUsage(): UsageDatum {
  return cloneUsage(undefined)
}

const rangeTimeline = computed<TimelineDay[]>(() => timeline.value.filter((day) => isDateInChartRange(day.date)))
const projectSourceSet = computed(() => (
  projectScope.value ? new Set(projectScope.value.sources.map((source) => source.id)) : null
))
const effectiveSourceSet = computed(() => {
  const projectSources = projectSourceSet.value
  if (agentFilter.value.length > 0) {
    const selected = new Set(agentFilter.value)
    return projectSources
      ? new Set([...selected].filter((sourceId) => projectSources.has(sourceId)))
      : selected
  }
  return projectSources
})
const sourceScopedTimeline = computed<TimelineDay[]>(() => {
  const sourceSet = effectiveSourceSet.value
  return sourceSet
    ? filterTimelineBySourceIds(rangeTimeline.value, sourceSet) as TimelineDay[]
    : rangeTimeline.value
})

function clientIdForSource(sourceId: string): Exclude<ClientFilter, 'all'> {
  if (!isLocalUsageSourceId(sourceId)) return 'openclaw'
  return localUsageSourceAppId(sourceId) === 'claude-code' ? 'claude-code' : 'codex'
}

const clientRows = computed(() => {
  const clients: Array<{ id: Exclude<ClientFilter, 'all'>; name: string; usage: UsageDatum }> = [
    { id: 'openclaw', name: 'OpenClaw', usage: emptyUsage() },
    { id: 'codex', name: 'Codex', usage: emptyUsage() },
    { id: 'claude-code', name: 'Claude Code', usage: emptyUsage() },
  ]
  const byId = new Map(clients.map((client) => [client.id, client]))
  for (const day of sourceScopedTimeline.value) {
    for (const [sourceId, modelMap] of Object.entries(day.byAgentByModel || {})) {
      const client = byId.get(clientIdForSource(sourceId))
      if (!client) continue
      for (const usage of Object.values(modelMap || {})) addUsage(client.usage, usage)
    }
  }
  const totalCost = clients.reduce((sum, client) => sum + client.usage.cost, 0)
  return clients.map((client) => ({
    ...client,
    pct: totalCost > 0 ? Math.round((client.usage.cost / totalCost) * 100) : 0,
  }))
})

const filteredTimeline = computed<TimelineDay[]>(() => {
  if (!hasModelFilter.value) return sourceScopedTimeline.value
  return sourceScopedTimeline.value.map((day) => {
    const outByModel: ModelUsageMap = createSafeRecord()
    const outByAgentByModel: AgentModelUsageMap = createSafeRecord()
    const byModelEntries = Object.entries(day.byModel || {})

    if (byModelEntries.length === 0) {
      if (isModelSelected('unknown')) outByModel.unknown = cloneUsage(day)
    } else {
      for (const [model, usage] of byModelEntries) {
        if (isModelSelected(model)) outByModel[model] = cloneUsage(usage)
      }
    }

    const modelsWithModelTotals = new Set(Object.keys(outByModel))
    for (const [agentId, modelMap] of Object.entries(day.byAgentByModel || {})) {
      for (const [model, usage] of Object.entries(modelMap || {})) {
        if (!isModelSelected(model)) continue
        if (!Object.hasOwn(outByAgentByModel, agentId)) outByAgentByModel[agentId] = createSafeRecord()
        outByAgentByModel[agentId][model] = cloneUsage(usage)
        if (!modelsWithModelTotals.has(model)) addUsageToMap(outByModel, model, usage)
      }
    }

    const totals = Object.values(outByModel).reduce(
      (sum, usage) => {
        addUsage(sum, usage)
        return sum
      },
      emptyUsage(),
    )

    return {
      ...day,
      tokens: totals.tokens,
      cost: totals.cost,
      byModel: outByModel,
      byAgentByModel: outByAgentByModel,
    }
  })
})

const modelTableTimeline = computed<TimelineDay[]>(() => {
  if (clientFilter.value === 'all') return filteredTimeline.value
  const sources = new Set<string>()
  for (const day of filteredTimeline.value) {
    for (const sourceId of Object.keys(day.byAgentByModel || {})) {
      if (clientIdForSource(sourceId) === clientFilter.value) sources.add(sourceId)
    }
  }
  return filterTimelineBySourceIds(filteredTimeline.value, sources) as TimelineDay[]
})

const chartMaxCost = computed(() => Math.max(...filteredTimeline.value.map(d => d.cost), 0.0001))
const chartMaxTokens = computed(() => Math.max(...filteredTimeline.value.map(d => d.tokens), 1))

interface ChartPoint {
  x: number
  y: number
  date: string
  tokens: number
  cost: number
  label: string
  priceStatus?: UsageDatum['priceStatus']
  billingMode?: UsageDatum['billingMode']
}

function buildChartPoints(metric: 'cost' | 'tokens', maxValue: number): ChartPoint[] {
  if (filteredTimeline.value.length < 2) return []
  const n = filteredTimeline.value.length
  const plotW = SVG_W.value - PAD_L.value - PAD_R.value
  const plotH = SVG_H.value - PAD_T - PAD_B
  return filteredTimeline.value.map((d, i) => {
    const x = PAD_L.value + (i / (n - 1)) * plotW
    const y = PAD_T + plotH - ((d[metric] || 0) / maxValue) * plotH
    return { x, y, date: d.date, tokens: d.tokens, cost: d.cost, label: formatChartLabel(d.date), priceStatus: d.priceStatus, billingMode: d.billingMode }
  })
}

const costChartPoints = computed<ChartPoint[]>(() => buildChartPoints('cost', detailScale.value.cost.max))
const tokenChartPoints = computed<ChartPoint[]>(() => buildChartPoints('tokens', detailScale.value.tokens.max))

function linePathFor(points: ChartPoint[]): string {
  if (!points.length) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

function areaPathFor(points: ChartPoint[]): string {
  if (!points.length) return ''
  const bottom = SVG_H.value - PAD_B
  const line = linePathFor(points)
  return `${line} L${points[points.length-1].x.toFixed(1)},${bottom} L${points[0].x.toFixed(1)},${bottom} Z`
}

const costLinePath = computed(() => linePathFor(costChartPoints.value))
const tokenLinePath = computed(() => linePathFor(tokenChartPoints.value))
const costAreaPath = computed(() => areaPathFor(costChartPoints.value))
const tokenAreaPath = computed(() => areaPathFor(tokenChartPoints.value))
const xLabelInterval = computed(() => {
  const plotW = SVG_W.value - PAD_L.value - PAD_R.value
  const maxTicks = Math.max(2, Math.floor(plotW / 56))
  return Math.max(1, Math.ceil(costChartPoints.value.length / maxTicks))
})
const showChartDots = computed(() => filteredTimeline.value.length <= 90)
const hoveredChartPoint = computed(() => {
  const index = hoveredChartIndex.value
  if (index === null) return null
  const day = filteredTimeline.value[index]
  const tokenPoint = tokenChartPoints.value[index]
  const costPoint = costChartPoints.value[index]
  if (!day || !tokenPoint || !costPoint) return null
  const basePoint = chartMetric.value === 'cost' ? costPoint : tokenPoint
  return {
    ...basePoint,
    tokens: day.tokens,
    cost: day.cost,
    priceStatus: day.priceStatus,
    billingMode: day.billingMode,
    tokenY: tokenPoint.y,
    costY: costPoint.y,
  }
})

function handleChartMouseMove(event: MouseEvent) {
  const points = costChartPoints.value.length ? costChartPoints.value : tokenChartPoints.value
  if (!points.length) {
    clearChartHover()
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const svgX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * SVG_W.value
  let nextIndex = 0
  let nextDistance = Infinity
  points.forEach((point, index) => {
    const distance = Math.abs(point.x - svgX)
    if (distance < nextDistance) {
      nextDistance = distance
      nextIndex = index
    }
  })
  hoveredChartIndex.value = nextIndex
}

function clearChartHover() {
  hoveredChartIndex.value = null
}

const chartTooltipStyle = computed(() => {
  const point = hoveredChartPoint.value
  if (!point) return {}
  const leftPercent = Math.min(86, Math.max(14, (point.x / SVG_W.value) * 100))
  return { left: `${leftPercent}%` }
})

const gridLines = computed(() => detailAxisTicks.value.map(t => t.y))

const peakDay = computed(() => {
  if (!filteredTimeline.value.length) return null
  if (chartMetric.value === 'cost') return [...filteredTimeline.value].sort((a, b) => b.cost - a.cost)[0]
  return [...filteredTimeline.value].sort((a, b) => b.tokens - a.tokens)[0]
})

const peakLabel = computed(() => {
  if (!peakDay.value) return ''
  if (chartMetric.value === 'cost') {
    return `峰值：${peakDay.value.date} — ¥${peakDay.value.cost.toFixed(4)} / ${formatTokenZhWithRaw(peakDay.value.tokens)}`
  }
  return `峰值：${peakDay.value.date} — ${formatTokenZhWithRaw(peakDay.value.tokens)} / ¥${peakDay.value.cost.toFixed(4)}`
})

// 同比计算
function sumMetricRange(start: number, end: number): number {
  const key = activeMetricProp.value
  return filteredTimeline.value.slice(start, end).reduce((s, d) => s + (Number(d[key]) || 0), 0)
}
const weeklyChangePercent = computed(() => {
  const n = filteredTimeline.value.length
  if (n < 14) return 0
  const thisWeek = sumMetricRange(n - 7, n)
  const lastWeek = sumMetricRange(n - 14, n - 7)
  if (lastWeek === 0) return 0
  return Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
})
const monthOverMonth = computed(() => {
  const n = filteredTimeline.value.length
  if (n < 30) return 0
  const thisHalf = sumMetricRange(n - 15, n)
  const lastHalf = sumMetricRange(n - 30, n - 15)
  if (lastHalf === 0) return 0
  return Math.round(((thisHalf - lastHalf) / lastHalf) * 100)
})

// 模型颜色映射
const MODEL_COLORS: Record<string, string> = safeRecordFrom({
  'deepseek-v4-flash': '#5e5ce6',
  'deepseek-v4-pro': '#5e5ce6',
  'deepseek-v3': '#5e5ce6',
  'deepseek-chat': '#5e5ce6',
  'deepseek-reasoner': '#5e5ce6',
  'MiniMax-M2.7': '#30d158',
  'claude-fable-5': '#ff9f0a',
  'claude-opus-4-8': '#ff9f0a',
  'claude-sonnet-5': '#ff9f0a',
  'claude-haiku-4-5': '#ff9f0a',
  'claude-sonnet-4-6': '#ff9f0a',
  'claude-sonnet-4-5': '#ff9f0a',
  'claude-opus-4': '#ff9f0a',
  'claude-opus-4-6': '#ff9f0a',
  'claude-opus-4-7': '#ff9f0a',
  'claude-opus-4-5': '#ff9f0a',
  'chat-latest': '#0a84ff',
  'gpt-5.3-codex': '#0a84ff',
  'gpt-5.4': '#0a84ff',
  'gpt-5.4-mini': '#0a84ff',
  'gpt-5.4-nano': '#0a84ff',
  'gpt-5.4-pro': '#0a84ff',
  'gpt-4o': '#5e5ce6',
  'gpt-4o-mini': '#5e5ce6',
  'gpt-5.5': '#0a84ff',
  'gpt-5.5-pro': '#0a84ff',
  'gpt-5.6-sol': '#0a84ff',
  'gpt-5.6-terra': '#5e5ce6',
  'gpt-5.6-luna': '#64d2ff',
})
const FALLBACK_COLORS = ['#bf5af2', '#ff375f', '#06b6d4', '#84cc16', '#ff9f0a']
let colorIdx = 0
const dynamicColors: Record<string, string> = createSafeRecord()

function getModelColor(model: string): string {
  const configured = ownValue(MODEL_COLORS, model)
  if (configured) return configured
  if (!Object.hasOwn(dynamicColors, model)) {
    dynamicColors[model] = FALLBACK_COLORS[colorIdx % FALLBACK_COLORS.length]
    colorIdx++
  }
  return dynamicColors[model]
}

// 模型显示名映射
const MODEL_DISPLAY: Record<string, string> = safeRecordFrom({
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v3': 'DeepSeek V3',
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
  'MiniMax-M2.7': 'MiniMax M2.7',
  'claude-fable-5': 'Claude Fable 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-opus-4': 'Claude Opus 4',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-opus-4-5': 'Claude Opus 4.5',
  'chat-latest': 'ChatGPT Latest',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.4-nano': 'GPT-5.4 Nano',
  'gpt-5.4-pro': 'GPT-5.4 Pro',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.5-pro': 'GPT-5.5 Pro',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'Qwen3.5-4B-OptiQ-4bit': '本地 Qwen3.5 4B',
  'qwen3.5': '本地 Qwen3.5',
  'qwen3.5:9b': '本地 Qwen3.5 9B',
  'qwen2.5': '本地 Qwen2.5',
  'gemma3:12b': '本地 Gemma 3 12B',
  'unknown': '未知模型',
})

function getModelDisplayName(model: string): string {
  const lower = String(model || '').toLowerCase()
  if (lower.includes('qwen')) return `本地千问 ${model.replace(/^.*qwen/i, 'Qwen')}`
  if (lower.includes('gemma')) return `本地 Google ${model.replace(/^.*gemma/i, 'Gemma')}`
  return ownValue(MODEL_DISPLAY, model) || model
}

function sortAgentRows(a: { agentName?: string; agentId?: string }, b: { agentName?: string; agentId?: string }): number {
  const left = a.agentName || a.agentId || ''
  const right = b.agentName || b.agentId || ''
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function sortModelRows(a: { model?: string }, b: { model?: string }): number {
  return getModelDisplayName(a.model || '').localeCompare(
    getModelDisplayName(b.model || ''),
    'zh-CN',
    { numeric: true, sensitivity: 'base' },
  )
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
  return getModelDisplayName(model)
}

// Agent 显示名（从 store）
function getAgentDisplayName(agentId: string): string {
  const scopedName = projectScope.value?.sources.find((source) => source.id === agentId)?.name
  if (scopedName) return scopedName
  if (isLocalUsageSourceId(agentId)) return localUsageSourceDisplayName(agentId)
  const agent = store.agents.find(a => {
    const id = (a.key || '').split(':')[1] || ''
    return id === agentId
  })
  return agent?.name || agentId
}

function getAgentEmoji(agentId: string): string {
  if (isLocalUsageSourceId(agentId)) return ''
  const agent = store.agents.find(a => {
    const id = (a.key || '').split(':')[1] || ''
    return id === agentId
  })
  return agent?.emoji || ''
}

const avatarFailed = ref<Record<string, boolean>>(createSafeRecord())
function getAgentAvatarSrc(agentId: string): string {
  if (isLocalUsageSourceId(agentId)) return localUsageSourceAvatarSrc(agentId)
  const agent = store.agents.find(item => ((item.key || '').split(':')[1] || '') === agentId)
  return normalizeAgentAvatarSource(agent?.avatar)
}

function handleAgentAvatarError(agentId: string, _event: Event): void {
  avatarFailed.value[agentId] = true
}

function addUsage(target: UsageDatum, usage: Partial<UsageDatum> | undefined) {
  if (!usage) return
  target.tokens += Number(usage.tokens) || 0
  target.cost += Number(usage.cost) || 0
  target.input = (Number(target.input) || 0) + (Number(usage.input) || 0)
  target.output = (Number(target.output) || 0) + (Number(usage.output) || 0)
  target.cacheRead = (Number(target.cacheRead) || 0) + (Number(usage.cacheRead) || 0)
  target.cacheWrite = (Number(target.cacheWrite) || 0) + (Number(usage.cacheWrite) || 0)
  target.inputCost = (Number(target.inputCost) || 0) + (Number(usage.inputCost) || 0)
  target.outputCost = (Number(target.outputCost) || 0) + (Number(usage.outputCost) || 0)
  target.cacheReadCost = (Number(target.cacheReadCost) || 0) + (Number(usage.cacheReadCost) || 0)
  target.cacheWriteCost = (Number(target.cacheWriteCost) || 0) + (Number(usage.cacheWriteCost) || 0)
  target.longContextCost = (Number(target.longContextCost) || 0) + (Number(usage.longContextCost) || 0)
  target.noCacheCost = (Number(target.noCacheCost) || 0) + (Number(usage.noCacheCost) || 0)
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

function addUsageToMap(map: ModelUsageMap, key: string, usage: Partial<UsageDatum> | undefined) {
  if (!Object.hasOwn(map, key)) map[key] = emptyUsage()
  addUsage(map[key], usage)
}

function exactCostParts(usage: Partial<UsageDatum>): {
  inputCost: number
  outputCost: number
  cacheCost: number
  longContextCost: number
  noCacheCost: number
} {
  return {
    inputCost: Number(usage.inputCost) || 0,
    outputCost: Number(usage.outputCost) || 0,
    cacheCost: (Number(usage.cacheReadCost) || 0) + (Number(usage.cacheWriteCost) || 0),
    longContextCost: Number(usage.longContextCost) || 0,
    noCacheCost: Number(usage.noCacheCost) || 0,
  }
}

function formatStandaloneCost(value: number): string {
  return `¥${Math.max(0, Number(value) || 0).toFixed(2)}`
}

function formatCostDetail(value: number, priceStatus?: UsageDatum['priceStatus'], billingMode?: UsageDatum['billingMode']): string {
  if (priceStatus === 'unconfigured') return '价格未配置'
  if (priceStatus === 'partial') return `部分未配置 · ${value > 0 ? `¥${value.toFixed(4)}` : '¥0'}`
  if (billingMode === 'free') return '¥0（免费）'
  return value > 0 ? `¥${value.toFixed(4)}` : '-'
}

const timelineTotals = computed(() => filteredTimeline.value.reduce(
  (sum, day) => {
    addUsage(sum, day)
    return sum
  },
  emptyUsage(),
))

const rangeByModel = computed<ModelUsageMap>(() => {
  const out: ModelUsageMap = createSafeRecord()
  for (const day of modelTableTimeline.value) {
    const byModel = day.byModel || {}
    const entries = Object.entries(byModel)
    if (entries.length === 0) {
      if ((Number(day.tokens) || 0) > 0 || (Number(day.cost) || 0) > 0) addUsageToMap(out, 'unknown', day)
      continue
    }
    for (const [model, usage] of entries) {
      addUsageToMap(out, model, usage)
    }
  }
  return out
})

const rangeByAgentByModel = computed<AgentModelUsageMap>(() => {
  const out: AgentModelUsageMap = createSafeRecord()
  for (const day of filteredTimeline.value) {
    const byAgent = day.byAgentByModel || {}
    for (const [agentId, modelMap] of Object.entries(byAgent)) {
      if (!Object.hasOwn(out, agentId)) out[agentId] = createSafeRecord()
      for (const [model, usage] of Object.entries(modelMap || {})) {
        addUsageToMap(out[agentId], model, usage)
      }
    }
  }
  return out
})

// 当前图表范围总计
const totalTokens = computed(() => timelineTotals.value.tokens)
const noCacheCost = computed(() => Number(timelineTotals.value.noCacheCost) || 0)
const cacheHitRate = computed(() => {
  const cacheRead = Number(timelineTotals.value.cacheRead) || 0
  const allInput = (Number(timelineTotals.value.input) || 0)
    + cacheRead
    + (Number(timelineTotals.value.cacheWrite) || 0)
  return allInput > 0 ? (cacheRead / allInput) * 100 : 0
})
const cacheHitRateText = computed(() => `${cacheHitRate.value.toFixed(1)}%`)
const modelTableTotalTokens = computed(() => Object.values(rangeByModel.value)
  .reduce((sum, usage) => sum + (Number(usage.tokens) || 0), 0))
const modelTableTotalCost = computed(() => Object.values(rangeByModel.value)
  .reduce((sum, usage) => sum + (Number(usage.cost) || 0), 0))
const activeMetricProp = computed<'tokens' | 'cost'>(() => chartMetric.value === 'cost' ? 'cost' : 'tokens')

function startOfLocalDay(date: Date): Date { const n = new Date(date); n.setHours(0,0,0,0); return n }
function addDays(date: Date, days: number): Date { const n = new Date(date); n.setDate(n.getDate()+days); return n }
function dateKeyToTime(dateKey: string): number {
  const text = String(dateKey || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00`).getTime()
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)) return new Date(text.replace(' ', 'T')).getTime()
  return Date.parse(text)
}
function timelineDatePart(dateKey: string): string {
  const match = String(dateKey || '').match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : dateKey
}
function formatChartLabel(dateKey: string): string {
  const hourMatch = String(dateKey || '').match(/^\d{4}-\d{2}-\d{2}\s+(\d{2}):/)
  if (hourMatch) return `${hourMatch[1]}:00`
  const parts = String(dateKey || '').split('-')
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : dateKey
}
function normalizeDateRange(value: string[] | null | undefined): [string, string] | null {
  if (!Array.isArray(value) || value.length < 2 || !value[0] || !value[1]) return null
  const [a, b] = value
  return dateKeyToTime(a) <= dateKeyToTime(b) ? [a, b] : [b, a]
}
// 范围→请求天数
function chartRequestDays(range: ChartRangeValue): number | 'all' {
  const today = startOfLocalDay(new Date())
  if (range === 'today') return 1
  if (range === '3d') return 3
  if (range === '7d') return 7
  if (range === '30d') return 30
  if (range === 'month') return today.getDate()
  if (range === 'lastMonth') {
    const lm = new Date(today.getFullYear(), today.getMonth()-1, 1)
    return Math.min(90, Math.max(1, Math.ceil((today.getTime()-lm.getTime())/86400000)+1))
  }
  if (range === 'custom') {
    const start = chartCustomRange.value?.[0]
    if (!start) return 'all'
    const st = dateKeyToTime(start)
    if (!Number.isFinite(st)) return 'all'
    const d = Math.max(1, Math.ceil((today.getTime()-st)/86400000)+1)
    return d > 90 ? 'all' : d
  }
  return 'all'
}
// 客户端精确过滤
function isDateInChartRange(dateKey: string): boolean {
  const today = startOfLocalDay(new Date())
  const target = dateKeyToTime(dateKey)
  if (!Number.isFinite(target)) return false
  const datePart = timelineDatePart(dateKey)
  const r = chartRange.value
  if (r === 'today') return datePart === formatDateKey(today)
  if (r === '3d') return target >= addDays(today,-2).getTime() && target <= today.getTime()
  if (r === '7d') return target >= addDays(today,-6).getTime() && target <= today.getTime()
  if (r === '30d') return target >= addDays(today,-29).getTime() && target <= today.getTime()
  if (r === 'month') return target >= new Date(today.getFullYear(), today.getMonth(), 1).getTime() && target <= today.getTime()
  if (r === 'lastMonth') {
    const lmStart = new Date(today.getFullYear(), today.getMonth()-1, 1).getTime()
    const mStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime()
    return target >= lmStart && target < mStart
  }
  if (r === 'custom') {
    const rg = chartCustomRange.value
    if (!rg) return true
    return target >= dateKeyToTime(rg[0]) && target <= dateKeyToTime(rg[1])
  }
  return true
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatPeriodCost(usage: Partial<UsageDatum>): string {
  if (usage.priceStatus === 'unconfigured') return '价格未配置'
  const cost = Number(usage.cost) || 0
  if (usage.billingMode === 'free') return '¥0（免费）'
  const text = cost > 0 ? `¥${cost.toFixed(2)}` : '¥0'
  return usage.priceStatus === 'partial' ? `部分未配置 · ${text}` : text
}

const tableScopeHint = computed(() => {
  const client = clientFilter.value === 'all'
    ? '全部客户端'
    : clientRows.value.find((row) => row.id === clientFilter.value)?.name || '全部客户端'
  return `${chartRangeTitle.value} · ${client} · ${modelScopeHint.value}`
})

const modelScopeHint = computed(() => {
  if (modelFilter.value.length === 0) return '全部模型'
  const names = modelFilter.value.map(model => getModelDisplayName(model))
  if (names.length <= 2) return names.join('、')
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 个模型`
})

// 按模型汇总行
const modelRows = computed(() => {
  const byModel = rangeByModel.value
  const safeTotal = modelTableTotalCost.value || 1
  return Object.entries(byModel)
    .filter(([, data]) => (Number(data.tokens) || 0) > 0 || (Number(data.cost) || 0) > 0)
    .map(([model, data]) => {
      const costParts = exactCostParts(data)
      return {
        model,
        displayName: getModelDisplayName(model),
        tokens: data.tokens,
        cost: data.cost,
      priceStatus: data.priceStatus,
      billingMode: data.billingMode,
        input: Number(data.input) || 0,
        output: Number(data.output) || 0,
        cacheTokens: (Number(data.cacheRead) || 0) + (Number(data.cacheWrite) || 0),
        ...costParts,
        pct: Math.round(((Number(data.cost) || 0) / safeTotal) * 100),
        color: getModelColor(model),
      }
    })
    .sort((a, b) => b.cost - a.cost)
})

// 各 Agent x 模型明细行（扁平化，每行独立——不再用 isFirst 分组以兼容筛排）
const agentModelRows = computed(() => {
  const byAgentByModel = rangeByAgentByModel.value
  const metric = activeMetricProp.value
  const rows: Array<{
    agentId: string
    agentName: string
    emoji: string
    model: string
    tokens: number
    cost: number
    input: number
    output: number
    cacheTokens: number
    inputCost: number
    outputCost: number
    cacheCost: number
    priceStatus?: UsageDatum['priceStatus']
    billingMode?: UsageDatum['billingMode']
  }> = []
  for (const [agentId, modelMap] of Object.entries(byAgentByModel)) {
    if (!modelMap) continue
    for (const [model, data] of Object.entries(modelMap)) {
      const costParts = exactCostParts(data)
      rows.push({
        agentId,
        agentName: getAgentDisplayName(agentId),
        emoji: getAgentEmoji(agentId),
        model,
        tokens: data.tokens,
        cost: data.cost,
        priceStatus: data.priceStatus,
        billingMode: data.billingMode,
        input: Number(data.input) || 0,
        output: Number(data.output) || 0,
        cacheTokens: (Number(data.cacheRead) || 0) + (Number(data.cacheWrite) || 0),
        ...costParts,
      })
    }
  }
  return rows.sort((a, b) => b[metric] - a[metric])
})

// 表头 Agent 筛选下拉选项（去重，按名称排序）
const agentFilterOptions = computed(() => {
  if (projectScope.value) {
    return projectScope.value.sources.map((source) => ({ text: source.name, value: source.id }))
  }
  const seen = new Map<string, string>()
  for (const row of agentModelRows.value) {
    if (!seen.has(row.agentId)) seen.set(row.agentId, row.agentName)
  }
  return [...seen.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
    .map(([id, name]) => ({ text: name, value: id }))
})

// 表头 模型 筛选下拉选项
const modelFilterOptions = computed(() => {
  const seen = new Set<string>()
  for (const day of sourceScopedTimeline.value) {
    const byModel = day.byModel || {}
    const modelEntries = Object.keys(byModel)
    if (modelEntries.length === 0 && ((Number(day.tokens) || 0) > 0 || (Number(day.cost) || 0) > 0)) {
      seen.add('unknown')
    }
    for (const model of modelEntries) seen.add(model)
    for (const modelMap of Object.values(day.byAgentByModel || {})) {
      for (const model of Object.keys(modelMap || {})) seen.add(model)
    }
  }
  return [...seen]
    .sort((a, b) => getModelDisplayName(a).localeCompare(getModelDisplayName(b)))
    .map(model => ({ text: getModelDisplayName(model), value: model }))
})

function applySourceFilter(value = props.sourceFilter) {
  const allowed = projectSourceSet.value
  agentFilter.value = value && (!allowed || allowed.has(value)) ? [value] : []
}

watch(visible, (val) => {
  if (val) {
    clientFilter.value = 'all'
    applySourceFilter()
  }
})

watch(() => props.sourceFilter, (value) => {
  if (visible.value) applySourceFilter(value)
})

watch(() => props.projectScope, () => {
  if (visible.value) applySourceFilter()
}, { deep: true })

const filteredAgentModelRows = computed(() => {
  return agentModelRows.value.filter(row => {
    if (agentFilter.value.length > 0 && !agentFilter.value.includes(row.agentId)) return false
    if (modelFilter.value.length > 0 && !modelFilter.value.includes(row.model)) return false
    return true
  })
})
</script>

<style scoped>
.section {
  margin-bottom: 4px;
}

.project-scope-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  padding: 9px 12px;
  border: 1px solid rgba(10, 132, 255, 0.38);
  background: rgba(10, 132, 255, 0.1);
  color: var(--text-secondary);
  font-size: 12px;
}

.project-scope-banner > div {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.project-scope-actions {
  flex: 0 0 auto;
}

.project-scope-banner strong {
  color: #0a84ff;
}

.project-scope-banner span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e5e5ea);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color, #2c2c2e);
}

.section-hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary, #98989d);
  margin-left: 6px;
  opacity: 0.75;
}

/* Sprint 8: 时间范围切换 */
.detail-metric-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  flex-wrap: wrap;
}
.detail-range-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.detail-range-quick { display: flex; gap: 6px; }
.detail-metric-right { display: flex; align-items: center; gap: 8px; }
.chart-custom-range,
.chart-custom-range.el-date-editor,
.detail-range-controls :deep(.el-date-editor.el-range-editor) {
  width: 228px !important;
  min-width: 0 !important;
  flex: 0 0 228px;
}
.detail-range-controls :deep(.el-range-input) { font-size: 12px; }
.detail-range-controls :deep(.el-range-separator) { padding: 0 2px; }

.detail-metric-label {
  color: var(--text-primary, #e5e5ea);
  font-size: 12px;
  font-weight: 700;
}

.chart-range-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.top-metric-switch {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border: 1px solid rgba(10, 132, 255, 0.16);
  border-radius: 999px;
  background: rgba(10, 132, 255, 0.04);
}
.metric-switch-btn {
  height: 23px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary, #98989d);
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.metric-switch-btn:hover {
  color: var(--text-primary, #e5e5ea);
  background: rgba(255, 255, 255, 0.055);
}
.metric-switch-btn.active {
  color: #6cb2ff;
  border-color: rgba(10, 132, 255, 0.42);
  background: rgba(10, 132, 255, 0.16);
}
.metric-switch-btn:disabled {
  opacity: 0.5;
  cursor: progress;
}
.range-btn {
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 12px;
  padding: 3px 10px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.range-btn:hover { background: var(--fill-hover); color: var(--text-primary); }
.range-btn.active { background: rgba(10, 132, 255,0.2); border-color: rgba(10, 132, 255,0.5); color: #0a84ff; }
.range-btn:disabled,
.legend-toggle:disabled {
  opacity: 0.5;
  cursor: progress;
}
.range-model-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  min-width: 0;
}
.range-model-label {
  color: var(--text-secondary, #98989d);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.range-model-select {
  width: 220px;
}
.hint-up { color: #ff6961 !important; font-size: 10px; }
.hint-down { color: #4ade80 !important; font-size: 10px; }

/* 时段费用速览卡（Sprint 1 + Sprint 8 加本周列，5 列） */
.period-card {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  margin-bottom: 16px;
  padding: 14px;
  background: linear-gradient(135deg, rgba(48, 209, 88,0.06), rgba(10, 132, 255,0.06));
  border: 1px solid var(--border-color);
  border-radius: 8px;
}
.period-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 4px;
}
.period-item.highlight {
  background: rgba(255, 159, 10,0.06);
  border-radius: 6px;
  padding: 4px 8px;
}
.period-label {
  font-size: 11px;
  color: var(--text-secondary, #98989d);
  font-weight: 500;
}
.period-value {
  font-size: 18px;
  font-weight: 700;
  color: #30d158;
  font-variant-numeric: tabular-nums;
}
.period-card--tokens .period-value {
  color: #0a84ff;
}
.period-card--cost .period-value {
  color: #30d158;
}
.period-value--stacked {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  line-height: 1.12;
}
.period-token {
  color: #0a84ff;
  font-size: 18px;
}
.period-cost {
  color: #30d158;
  font-size: 15px;
}
.range-value {
  font-size: 14px;
  line-height: 1.25;
  word-break: keep-all;
  white-space: normal;
}
.period-item.highlight .period-value { color: #30d158; }
.period-card--tokens .period-item.highlight .period-value { color: #0a84ff; }
.period-card--both .period-item.highlight .period-value { color: inherit; }
.period-hint {
  font-size: 10px;
  color: var(--text-secondary, #98989d);
  opacity: 0.7;
}

/* ── 筛选条 ── */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  flex-wrap: wrap;
}
.filter-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #98989d);
  white-space: nowrap;
}
.filter-select {
  width: 180px;
}
.filter-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary, #98989d);
  font-variant-numeric: tabular-nums;
}

.model-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.model-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 6px 16px rgba(0,0,0,0.18);
}

.model-logo--small {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  font-size: 9px;
}

.model-logo-img {
  width: 16px;
  height: 16px;
  display: block;
  object-fit: contain;
}

.model-logo--small .model-logo-img {
  width: 14px;
  height: 14px;
}

.model-logo--deepseek {
  background: linear-gradient(135deg, #5e5ce6, #4644b8);
}

.model-logo--minimax {
  background: linear-gradient(135deg, #30d158, #1f9e43);
}

.model-logo--openai {
  background: linear-gradient(135deg, #0a84ff, #0064d2);
}

.model-logo--anthropic {
  background: linear-gradient(135deg, #ff9f0a, #d97e06);
}

.model-logo--qwen {
  background: linear-gradient(135deg, #bf5af2, #8e44c9);
}

.model-logo--google {
  background: linear-gradient(135deg, #0a84ff, #0064d2);
}

.model-logo--local {
  background: linear-gradient(135deg, #30d158, #1f9e43);
}

.model-logo--generic {
  background: linear-gradient(135deg, #bf5af2, #8e44c9);
}

.model-name {
  font-size: 13px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-option-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.model-option-logo {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: 8px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14);
}

.model-option-logo .model-logo-img {
  width: 12px;
  height: 12px;
}

.model-option-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.token-num {
  color: #0a84ff;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 500;
}

.token-split-num {
  color: var(--text-secondary, #98989d);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.pct-num {
  font-size: 12px;
  color: var(--text-secondary, #98989d);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.pct-cell {
  display: grid;
  grid-template-columns: 42px minmax(92px, 1fr);
  gap: 10px;
  align-items: center;
  justify-content: end;
  width: 100%;
}

.pct-track {
  display: block;
  height: 8px;
  border-radius: 999px;
  background: rgba(152, 152, 157, 0.16);
  overflow: hidden;
}

.pct-fill {
  display: block;
  height: 100%;
  min-width: 2px;
  border-radius: inherit;
}

.cost-num {
  color: #30d158;
  font-weight: 500;
}

.cost-zero {
  color: var(--text-secondary, #98989d);
}

.total-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 20px;
  padding: 8px 12px;
  background: var(--bg-elevated, rgba(255,255,255,0.04));
  border-radius: 6px;
  margin-top: 6px;
  font-size: 13px;
}

.total-label {
  color: var(--text-secondary, #98989d);
  margin-right: auto;
  font-weight: 600;
}

.total-tokens {
  font-weight: 600;
  color: #0a84ff;
}

.total-cost {
  font-weight: 600;
  color: #30d158;
  min-width: 80px;
  text-align: right;
}

.agent-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-cell-empty {
  height: 20px;
}

.agent-avatar-sm {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--bg-elevated, rgba(255,255,255,0.08));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.agent-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 3px;
}
.agent-avatar-emoji {
  font-size: 13px;
  line-height: 1;
}
.agent-avatar-letter {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #98989d);
}

.agent-id-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary, #e5e5ea);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-table,
.agent-table {
  width: 100%;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.updated-at {
  font-size: 12px;
  color: var(--text-secondary, #98989d);
}

/* 覆盖 Element Plus 表格样式 */
:deep(.el-table) {
  background: transparent;
  font-size: 13px;
}

:deep(.el-table tr) {
  background: transparent;
}

:deep(.el-table--striped .el-table__body tr.el-table__row--striped td) {
  background: var(--fill-subtle);
}

:deep(.el-table th) {
  background: var(--fill-subtle);
  font-size: 11px;
  color: var(--text-secondary, #98989d);
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
}

:deep(.el-table .cell) {
  min-width: 0;
}

:deep(.el-table__body-wrapper) {
  overflow-x: hidden;
}

:deep(.el-table__inner-wrapper),
:deep(.el-table__header-wrapper),
:deep(.el-table__body-wrapper),
:deep(.el-table__header),
:deep(.el-table__body) {
  width: 100% !important;
}

/* ── Sprint 6: Chart ── */
.chart-section { margin-top: 0; }
.chart-compare {
  margin-left: auto;
  display: flex;
  gap: 12px;
  font-size: 11px;
  font-weight: 600;
}
.compare-item.up { color: #ff453a; }
.compare-item.down { color: #30d158; }

.cost-chart {
  position: relative;
  --chart-grid-line: rgba(255, 255, 255, 0.06);
  --chart-axis-label: rgba(255, 255, 255, 0.35);
  --chart-zero-label: rgba(255, 255, 255, 0.4);
  --chart-hover-line: rgba(255, 255, 255, 0.18);
  --chart-dot-stroke: rgba(22, 22, 23, 0.8);

  background: rgba(0,0,0,0.2);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}
.chart-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 12px;
  color: var(--text-muted);
}
.chart-tooltip {
  position: absolute;
  top: 8px;
  transform: translateX(-50%);
  min-width: 168px;
  padding: 8px 10px;
  border: 1px solid rgba(152, 152, 157,0.28);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: 0 10px 28px rgba(0,0,0,0.35);
  color: var(--text-primary, #e5e5ea);
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
  z-index: 2;
  backdrop-filter: blur(8px);
}
.tooltip-date {
  margin-bottom: 4px;
  color: rgba(229, 229, 234,0.86);
  font-weight: 700;
}
.tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.tooltip-row span {
  color: var(--text-secondary, #98989d);
}
.tooltip-row strong {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.token-row strong { color: #0a84ff; }
.cost-row strong { color: #30d158; }
.chart-legend {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-secondary, #98989d);
}
.legend-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--fill-subtle);
  color: var(--text-secondary, #98989d);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.legend-toggle:hover {
  background: var(--fill-subtle);
  color: var(--text-primary, #e5e5ea);
}
.legend-toggle.active {
  border-color: rgba(10, 132, 255,0.45);
  background: rgba(10, 132, 255,0.12);
  color: #e5e5ea;
}
.legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 999px;
}
.token-dot { background: #0a84ff; }
.cost-dot { background: #30d158; }
.chart-peak {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 6px;
  padding: 0 4px;
}

.api-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.api-summary-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--fill-subtle);
}
.api-summary-card span {
  color: var(--text-secondary);
  font-size: 11px;
}
.api-summary-card strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 19px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.api-summary-card--cost strong { color: #30d158; }
.api-summary-card--token strong { color: #0a84ff; }

.client-breakdown { margin-bottom: 14px; }
.client-breakdown-title { position: relative; }
.client-all-btn {
  margin-left: auto;
  padding: 3px 10px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}
.client-all-btn.active {
  border-color: rgba(10, 132, 255, 0.5);
  color: #6cb2ff;
  background: rgba(10, 132, 255, 0.14);
}
.client-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.client-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-secondary);
  background: var(--fill-subtle);
  cursor: pointer;
  text-align: left;
}
.client-card:hover,
.client-card.active {
  border-color: rgba(10, 132, 255, 0.48);
  background: rgba(10, 132, 255, 0.1);
}
.client-card-name { color: var(--text-primary); font-weight: 700; }
.client-card strong {
  color: #0a84ff;
  font-size: 17px;
  font-variant-numeric: tabular-nums;
}
.client-card-share { font-size: 11px; }

.model-cost-breakdown {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 16px;
  background: rgba(10, 132, 255, 0.045);
}
.model-cost-breakdown > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--fill-subtle);
}
.model-cost-breakdown span { color: var(--text-secondary); font-size: 11px; }
.model-cost-breakdown strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.model-cost-breakdown-total strong { color: #30d158; }

.chart-plot {
  position: relative;
  width: 100%;
  height: 210px;
}
.chart-plot .chart-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.chart-tick {
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.chart-tick--token { fill: #0a84ff; opacity: 0.85; }
.chart-tick--cost { fill: #30d158; opacity: 0.85; }
.chart-value-label {
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  paint-order: stroke;
  stroke: var(--bg-primary);
  stroke-width: 3.5px;
  stroke-linejoin: round;
}
html.light-theme .chart-value-label {
  stroke: #ffffff;
  stroke-width: 4px;
}

@media (max-width: 800px) {
  .api-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .client-card-grid { grid-template-columns: 1fr; }
  .model-cost-breakdown { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>

<!-- 非 scoped：filter popper 通过 Teleport 渲染到 body 层，必须用全局选择器 -->
<style>
.token-detail-dialog {
  max-width: calc(100vw - 64px);
}

.token-detail-dialog .el-dialog__body {
  overflow-x: hidden;
}

html.light-theme .token-detail-dialog .cost-chart {
  --chart-grid-line: rgba(31, 41, 55, 0.075);
  --chart-axis-label: rgba(17, 24, 39, 0.42);
  --chart-zero-label: rgba(17, 24, 39, 0.5);
  --chart-hover-line: rgba(10, 132, 255, 0.18);
  --chart-dot-stroke: rgba(255, 255, 255, 0.92);
  background:
    linear-gradient(180deg, rgba(10, 132, 255, 0.055), rgba(48, 209, 88, 0.025)),
    #f8fbff;
  border-color: rgba(10, 132, 255, 0.16);
}

html.light-theme .token-detail-dialog .chart-tooltip {
  background: rgba(255, 255, 255, 0.96);
  border-color: rgba(31, 41, 55, 0.12);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
}

html.light-theme .token-detail-dialog .tooltip-date {
  color: rgba(17, 24, 39, 0.84);
}

/* el-table filter 下拉菜单：z-index 必须高于 el-dialog（默认 2000），并适配深色主题 */
.el-table-filter.token-detail-filter-popper,
.el-table-filter {
  z-index: 4000 !important;
  background: var(--bg-elevated) !important;
  border: 1px solid var(--border-color) !important;
  box-shadow: 0 6px 24px rgba(0,0,0,0.18) !important;
}
.el-table-filter .el-table-filter__list {
  background: transparent !important;
}
.el-table-filter .el-table-filter__list-item {
  color: var(--text-primary) !important;
  font-size: 12px !important;
}
.el-table-filter .el-table-filter__list-item:hover {
  background: rgba(10, 132, 255,0.15) !important;
}
.el-table-filter .el-table-filter__list-item.is-active {
  background: rgba(10, 132, 255,0.25) !important;
  color: #6cb2ff !important;
  font-weight: 600;
}
.el-table-filter .el-table-filter__bottom {
  border-top: 1px solid var(--border-color) !important;
}
.el-table-filter .el-table-filter__bottom button {
  color: var(--text-secondary) !important;
}
.el-table-filter .el-table-filter__bottom button.is-disabled {
  color: var(--text-muted) !important;
}
.el-table-filter .el-table-filter__checkbox-group label {
  color: var(--text-primary) !important;
}
</style>
