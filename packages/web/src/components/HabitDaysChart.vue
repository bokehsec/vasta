<script setup lang="ts">
// Habit progress as a calendar of days: a column per week, Monday on top, each day darker the more
// of its habits got done. One of the two progress charts (the other is HabitTrendChart), drawn
// with the `cell` size it is given for the Tracker and the Progress tab alike; `labels` adds the
// weekdays and each week's date.
import { computed } from 'vue'
import { dayLabel, heatStyle, longDayLabel, type ProgressDay } from '../lib/habit-progress.ts'
import { metaText } from '../lib/type-scale.ts'

const props = defineProps<{ days: ProgressDay[][]; cell: number; labels?: boolean }>()

const GAP = 3
const WEEKDAYS = ['M', '', 'W', '', 'F', '', 'S']
/** Every nth week gets its date, so the dates don't run into each other. */
const labelEvery = computed(() => Math.max(1, Math.ceil(44 / (props.cell + GAP))))
const title = (d: ProgressDay) =>
  d.future ? `${longDayLabel(d.day)}: still to come` : d.total?.due ? `${longDayLabel(d.day)}: ${d.total.done} of ${d.total.due} done` : d.today ? `${longDayLabel(d.day)}: today, nothing done yet` : `${longDayLabel(d.day)}: nothing to do`
</script>

<template>
  <div class="max-w-full overflow-x-auto" data-habit-days>
    <div class="flex w-fit gap-1.5" role="img" :aria-label="`Share of each day's habits done, last ${days.length} weeks`">
      <div v-if="labels" class="grid leading-none text-ink-faint" :class="metaText" :style="{ gridTemplateRows: `${cell}px repeat(7, ${cell}px)`, rowGap: `${GAP}px` }">
        <span />
        <span v-for="(d, i) in WEEKDAYS" :key="i" class="grid items-center">{{ d }}</span>
      </div>
      <div>
        <div v-if="labels" class="relative leading-none text-ink-faint" :class="metaText" :style="{ height: `${cell + GAP}px` }">
          <template v-for="(week, i) in days" :key="week[0]!.day">
            <span v-if="i % labelEvery === 0" class="absolute top-0 whitespace-nowrap" :style="{ left: `${i * (cell + GAP)}px` }">{{ dayLabel(week[0]!.day) }}</span>
          </template>
        </div>
        <div class="grid" :style="{ gridTemplateColumns: `repeat(${days.length}, ${cell}px)`, gridTemplateRows: `repeat(7, ${cell}px)`, gridAutoFlow: 'column', gap: `${GAP}px` }">
          <template v-for="week in days" :key="week[0]!.day">
            <i v-for="d in week" :key="d.day" class="block rounded-[3px]" :class="d.future ? 'opacity-0' : ''" :style="heatStyle(d.total?.due ? d.total.done / d.total.due : undefined)" :title="title(d)" />
          </template>
        </div>
      </div>
    </div>
    <p v-if="labels" class="mt-2 flex items-center gap-1 text-ink-faint" :class="metaText">
      Share of the day's habits done
      <span class="inline-flex gap-0.5"><i v-for="s in [0, 0.25, 0.5, 0.75, 1]" :key="s" class="inline-block size-2.5 rounded-[2px]" :style="heatStyle(s)" /></span>
      less to more
    </p>
  </div>
</template>
