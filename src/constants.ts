// Refer: https://github.com/kelan/gyp.vim/blob/96a5b8d/syntax/gyp.vim#L19-L20
const GYP_SECTION_STR = 'variables includes targets conditions target_defaults';
const GYP_TARGET_SECTION_STR = 'actions all_dependent_settings configurations defines dependencies direct_dependent_settings include_dirs libraries link_settings sources target_conditions target_name type msvs_props xcode_config_file xcode_framework_dirs mac_bundle_resources xcode_settings';

export const GYP_SECTION = GYP_SECTION_STR.split(' ');
export const GYP_TARGET_SECTION = GYP_TARGET_SECTION_STR.split(' ');
