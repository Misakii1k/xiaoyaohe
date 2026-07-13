// 药物相互作用规则库 —— 用于在新增/编辑药品时给出风险提示。
// 规则覆盖常见抗凝、NSAID、降糖、降压、精神神经类及其他高频组合，
// 关键字采用中文通用名，与项目其他药品数据保持一致。

/** 一条药物相互作用规则 */
export interface DrugInteraction {
  /** 涉及的药物名称关键字列表（小写，用于模糊匹配） */
  drugs: string[];
  /** 严重等级：mild（轻微）/ moderate（中等）/ severe（严重） */
  severity: 'mild' | 'moderate' | 'severe';
  /** 相互作用描述（中文） */
  description: string;
}

/**
 * 常见药物相互作用组合（约 30 条）。
 * severity 分级约定：
 * - severe：可能致命/严重出血/严重心律失常/5-羟色胺综合征等
 * - moderate：需调整剂量或密切监测的中度风险
 * - mild：风险较低但仍需注意
 */
export const DRUG_INTERACTIONS: DrugInteraction[] = [
  // ===== 抗凝 / 抗血小板类 =====
  { drugs: ['华法林', '阿司匹林'], severity: 'severe', description: '两者均有抗凝/抗血小板作用，合用显著增加出血风险' },
  { drugs: ['华法林', '布洛芬'], severity: 'severe', description: 'NSAID 增加胃黏膜损伤并增强华法林抗凝效果，消化道出血风险显著升高' },
  { drugs: ['阿司匹林', '氯吡格雷'], severity: 'moderate', description: '双联抗血小板显著增加出血风险，需密切监测且仅在明确适应证下使用' },
  { drugs: ['华法林', '胺碘酮'], severity: 'severe', description: '胺碘酮抑制华法林代谢，可使 INR 显著升高，需减量并严密监测' },
  { drugs: ['华法林', '氟康唑'], severity: 'severe', description: '氟康唑强抑制 CYP2C9，华法林血药浓度升高，出血风险增加' },
  { drugs: ['华法林', '磺胺'], severity: 'moderate', description: '磺胺类置换血浆蛋白结合并抑制代谢，增强华法林抗凝作用' },

  // ===== NSAID 类 =====
  { drugs: ['布洛芬', '锂剂'], severity: 'moderate', description: 'NSAID 减少锂排泄，可致锂中毒，需监测血锂浓度' },
  { drugs: ['布洛芬', '甲氨蝶呤'], severity: 'severe', description: 'NSAID 减少甲氨蝶呤排泄，增加骨髓抑制和肝肾毒性风险' },
  { drugs: ['萘普生', '阿司匹林'], severity: 'moderate', description: '阿司匹林可置换萘普生结合位点，并竞争性抑制其抗血小板作用' },
  { drugs: ['塞来昔布', '华法林'], severity: 'moderate', description: '塞来昔布可增强华法林抗凝效果，合用需监测 INR' },
  { drugs: ['布洛芬', 'ACEI'], severity: 'moderate', description: 'NSAID 可削弱 ACEI 降压效果，并增加肾损伤风险' },
  { drugs: ['双氯芬酸', '利尿剂'], severity: 'moderate', description: 'NSAID 拮抗利尿剂作用，并增加急性肾衰竭风险' },

  // ===== 降糖药类 =====
  { drugs: ['二甲双胍', '造影剂'], severity: 'severe', description: '含碘造影剂可致急性肾损伤，叠加二甲双胍增加乳酸酸中毒风险，造影前后需停用' },
  { drugs: ['格列本脲', '氟康唑'], severity: 'severe', description: '氟康唑抑制磺脲类代谢，可致严重低血糖' },
  { drugs: ['胰岛素', 'β受体阻滞剂'], severity: 'moderate', description: 'β受体阻滞剂可掩盖低血糖心悸症状，并干扰血糖调节' },
  { drugs: ['二甲双胍', '酒精'], severity: 'moderate', description: '酒精增加乳酸酸中毒风险，长期饮酒者慎用二甲双胍' },
  { drugs: ['格列美脲', '利福平'], severity: 'moderate', description: '利福平诱导代谢降低磺脲类降糖效果，可能致血糖升高' },

  // ===== 降压药类 =====
  { drugs: ['ACEI', '螺内酯'], severity: 'severe', description: 'ACEI 与保钾利尿剂合用易致高钾血症，需密切监测血钾' },
  { drugs: ['β受体阻滞剂', '维拉帕米'], severity: 'severe', description: '两者合用可致严重心动过缓、房室传导阻滞，静脉给药禁忌' },
  { drugs: ['氨氯地平', '葡萄柚'], severity: 'moderate', description: '葡萄柚抑制 CYP3A4，升高氨氯地平血药浓度，增强降压作用' },
  { drugs: ['缬沙坦', '钾盐'], severity: 'moderate', description: 'ARB 类与钾盐合用增加高钾血症风险' },
  { drugs: ['厄贝沙坦', '锂剂'], severity: 'moderate', description: 'ARB 减少锂排泄，可致锂中毒，需监测血锂' },

  // ===== 精神 / 神经类 =====
  { drugs: ['SSRI', 'MAOI'], severity: 'severe', description: '可致 5-羟色胺综合征，两类药物转换需至少 2 周洗脱期' },
  { drugs: ['苯二氮卓', '酒精'], severity: 'severe', description: '中枢抑制叠加，可致严重呼吸抑制、嗜睡甚至昏迷' },
  { drugs: ['左旋多巴', '维生素B6'], severity: 'moderate', description: '维生素B6 加速左旋多巴外周脱羧，降低疗效（卡比多巴合用可减轻）' },
  { drugs: ['卡马西平', '葡萄柚'], severity: 'moderate', description: '葡萄柚抑制 CYP3A4，升高卡马西平血药浓度，增加中毒风险' },
  { drugs: ['锂剂', '利尿剂'], severity: 'severe', description: '利尿剂致钠丢失增加锂重吸收，可致锂中毒' },

  // ===== 其他 =====
  { drugs: ['他汀', '葡萄柚'], severity: 'moderate', description: '葡萄柚抑制 CYP3A4，升高他汀血药浓度，增加肌病和横纹肌溶解风险' },
  { drugs: ['甲状腺素', '钙剂'], severity: 'moderate', description: '钙剂影响左甲状腺素吸收，需间隔至少 4 小时服用' },
  { drugs: ['铁剂', '左旋多巴'], severity: 'moderate', description: '铁离子与左旋多巴络合，降低其吸收和疗效' },
  { drugs: ['奥美拉唑', '氯吡格雷'], severity: 'moderate', description: '奥美拉唑抑制 CYP2C19 减少氯吡格雷活化，降低抗血小板效果' },
];

/**
 * 检查给定药品列表中是否存在已知相互作用。
 *
 * 模糊匹配规则：medName 包含关键字即命中（不区分大小写）。
 * 例如 "华法林钠片" 命中关键字 "华法林"，"阿司匹林肠溶片" 命中 "阿司匹林"。
 *
 * 一条规则当且仅当其 drugs 中所有关键字都在 medNames 中找到匹配时才视为命中。
 *
 * @param medNames 药品名称数组，如 ['华法林钠片', '阿司匹林肠溶片']
 * @returns 命中的相互作用列表，可能为空数组
 */
export function checkInteractions(medNames: string[]): DrugInteraction[] {
  if (!Array.isArray(medNames) || medNames.length === 0) return [];
  const normalized = medNames.map((n) => (n ?? '').toLowerCase());
  const hits: DrugInteraction[] = [];
  for (const rule of DRUG_INTERACTIONS) {
    const allMatched = rule.drugs.every((kw) => {
      const k = kw.toLowerCase();
      return normalized.some((name) => name.includes(k));
    });
    if (allMatched) hits.push(rule);
  }
  return hits;
}
