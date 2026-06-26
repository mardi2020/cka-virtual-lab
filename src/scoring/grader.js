export function gradeQuestion(question, snapshot) {
  const checks = (question?.checks ?? []).map((check) => evaluateCheck(check, snapshot));
  const passedCount = checks.filter((check) => check.passed).length;
  const score = checks.length ? Math.round((passedCount / checks.length) * 100) : 0;
  const passed = checks.length > 0 && passedCount === checks.length;
  return {
    passed,
    score,
    checks,
    feedback: createFeedback({ passed, checks, passedCount }),
  };
}

function evaluateCheck(check, snapshot) {
  const actual = readPath(snapshot, check?.path);
  const details = evaluatePredicates(check ?? {}, actual);
  const passed = details.length > 0 && details.every((detail) => detail.passed);
  const failedDetail = details.find((detail) => !detail.passed);

  return {
    id: check?.id,
    label: check?.label,
    path: check?.path,
    passed,
    detail: createCheckDetail({ check, passed, failedDetail }),
    actual,
    details,
  };
}

function readPath(source, path) {
  if (typeof path !== "string" || path.length === 0) return undefined;
  return path.split(".").reduce((value, key) => value?.[key], source);
}

function evaluatePredicates(check, actual) {
  const details = [];

  if (hasOwn(check, "equals")) {
    details.push(createDetail("equals", check.equals, actual, deepEqual(actual, check.equals), {
      pass: "현재 값이 기대값과 같습니다.",
      fail: `현재 값 ${formatValue(actual)}이(가) 기대값 ${formatValue(check.equals)}와 다릅니다.`,
    }));
  }

  if (hasOwn(check, "notEquals")) {
    details.push(createDetail("notEquals", check.notEquals, actual, !deepEqual(actual, check.notEquals), {
      pass: "현재 값이 금지된 값과 다릅니다.",
      fail: `현재 값이 금지된 값 ${formatValue(check.notEquals)}와 같습니다.`,
    }));
  }

  if (hasOwn(check, "includes")) {
    details.push(createDetail("includes", check.includes, actual, includesValue(actual, check.includes), {
      pass: "현재 값에 기대한 값이 포함되어 있습니다.",
      fail: `현재 값 ${formatValue(actual)}에 ${formatValue(check.includes)}이(가) 포함되어야 합니다.`,
    }));
  }

  if (check.exists === true) {
    details.push(createDetail("exists", true, actual, actual !== undefined, {
      pass: "경로에 값이 있습니다.",
      fail: "경로에 값이 있어야 합니다.",
    }));
  }

  if (check.absent === true) {
    details.push(createDetail("absent", true, actual, actual === undefined, {
      pass: "경로에 값이 없습니다.",
      fail: `경로에 값 ${formatValue(actual)}이(가) 없어야 합니다.`,
    }));
  }

  if (hasOwn(check, "gte")) {
    const actualNumber = Number(actual);
    const expectedNumber = Number(check.gte);
    const passed = Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && actualNumber >= expectedNumber;
    details.push(createDetail("gte", check.gte, actual, passed, {
      pass: `현재 값 ${formatValue(actual)}이(가) ${formatValue(check.gte)} 이상입니다.`,
      fail: `현재 값 ${formatValue(actual)}이(가) ${formatValue(check.gte)} 이상이어야 합니다.`,
    }));
  }

  if (hasOwn(check, "lte")) {
    const actualNumber = Number(actual);
    const expectedNumber = Number(check.lte);
    const passed = Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && actualNumber <= expectedNumber;
    details.push(createDetail("lte", check.lte, actual, passed, {
      pass: `현재 값 ${formatValue(actual)}이(가) ${formatValue(check.lte)} 이하입니다.`,
      fail: `현재 값 ${formatValue(actual)}이(가) ${formatValue(check.lte)} 이하여야 합니다.`,
    }));
  }

  if (hasOwn(check, "oneOf")) {
    const options = Array.isArray(check.oneOf) ? check.oneOf : [];
    details.push(createDetail("oneOf", check.oneOf, actual, options.some((option) => deepEqual(actual, option)), {
      pass: "현재 값이 허용된 값 중 하나입니다.",
      fail: `현재 값 ${formatValue(actual)}이(가) 허용값 ${formatValue(check.oneOf)} 중 하나여야 합니다.`,
    }));
  }

  if (hasOwn(check, "lengthGte")) {
    const actualLength = readLength(actual);
    const expectedLength = Number(check.lengthGte);
    const passed = Number.isFinite(actualLength) && Number.isFinite(expectedLength) && actualLength >= expectedLength;
    details.push(createDetail("lengthGte", check.lengthGte, actualLength, passed, {
      pass: `길이 ${formatValue(actualLength)}이(가) ${formatValue(check.lengthGte)} 이상입니다.`,
      fail: `길이 ${formatValue(actualLength)}이(가) ${formatValue(check.lengthGte)} 이상이어야 합니다.`,
    }));
  }

  if (details.length === 0) {
    details.push({
      operator: "unsupported",
      expected: undefined,
      actual,
      passed: false,
      detail: "지원하지 않는 채점 조건입니다.",
    });
  }

  return details;
}

function createDetail(operator, expected, actual, passed, messages) {
  return {
    operator,
    expected,
    actual,
    passed,
    detail: passed ? messages.pass : messages.fail,
  };
}

function createFeedback({ passed, checks, passedCount }) {
  if (checks.length === 0) return "채점 조건이 없어 아직 점수를 계산할 수 없습니다.";
  if (passed) return "요구사항을 모두 만족했습니다. 다음 문제로 넘어가도 좋습니다.";
  return `${checks.length - passedCount}개 조건이 아직 남아 있습니다. 실패한 항목의 detail을 보고 상태를 맞춰보세요.`;
}

function createCheckDetail({ check, passed, failedDetail }) {
  if (passed) return "조건을 만족했습니다.";
  return check?.detail ?? failedDetail?.detail ?? "조건을 만족하지 못했습니다.";
}

function includesValue(actual, expected) {
  if (actual === undefined || actual === null) return false;
  if (Array.isArray(actual)) {
    return actual.some((item) => deepEqual(item, expected)) || String(actual).includes(String(expected));
  }
  return String(actual).includes(String(expected));
}

function readLength(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value).length;
  return undefined;
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]));
}

function formatValue(value) {
  if (value === undefined) return "없음";
  if (typeof value === "string") return `"${value}"`;

  try {
    const serialized = JSON.stringify(value);
    return truncate(serialized === undefined ? String(value) : serialized);
  } catch {
    return truncate(String(value));
  }
}

function truncate(value) {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}
