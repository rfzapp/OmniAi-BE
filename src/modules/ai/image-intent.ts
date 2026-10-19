const IMAGE_TERMS =
  /\b(?:image|images|picture|pictures|photo|photos|visual|visuals|illustration|illustrations|artwork|mockup|mockups|screenshot|screenshots|logo|logos|icon|icons|wallpaper|portrait|drawing|rendering|graphic|background|banner|poster|thumbnail|avatar|diagram|infographic|meme|sticker|emoji|painting|sketch)\b/i;
const GENERATION_ACTIONS =
  /\b(?:generate|create|draw|design|render|illustrate|paint|make)\b/i;
const GENERATION_TARGETS =
  /\b(?:something|anything|scene|landscape|cityscape|character|mascot|creature|animal|dinosaur|dragon|cover)\b/i;
const EDIT_ACTIONS =
  /\b(?:edit|modify|alter|change|replace|remove|erase|add|insert|crop|resize|brighten|darken|recolor|retouch|enhance|transform|make|turn|put)\b/i;
const EDIT_TARGETS =
  /\b(?:it|this|that|them|these|those|background|color|colour|lighting|style|suit|shirt|hair|eyes|sky|object|person|face|brighter|darker|realistic|cartoon|cinematic|professional)\b/i;
const IMAGE_DESCRIPTION =
  /\b(?:image|picture|photo|photograph|illustration|artwork|logo|drawing|render|graphic)\b\s+(?:of|showing|depicting|featuring|with|containing|in)\s+(?!me\b|us\b|you\b|something\b|anything\b|it\b|this\b|that\b)[a-z0-9]/i;
const CAPABILITY_QUESTION =
  /^\s*(?:can|could|would|will|do|does|is|are)\s+you\b/i;

export function mayHaveImageIntent(message: string): boolean {
  return IMAGE_TERMS.test(message)
    || (GENERATION_ACTIONS.test(message) && GENERATION_TARGETS.test(message))
    || (EDIT_ACTIONS.test(message) && EDIT_TARGETS.test(message));
}

export function isImageCapabilityQuestion(message: string): boolean {
  return CAPABILITY_QUESTION.test(message)
    && IMAGE_TERMS.test(message)
    && !IMAGE_DESCRIPTION.test(message);
}
