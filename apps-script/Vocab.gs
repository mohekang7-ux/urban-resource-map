/** 由 pipeline/apps_script_vocab.py 從 data/schema/ 產生，請勿手動修改。 */
const VOCAB = {
  "needs": [
    {
      "need_id": "buy_materials",
      "name_zh": "買材料",
      "question": "哪裡買得到木材、螺絲、防水漆？",
      "examples": "五金行；建材行；木材行；材料行"
    },
    {
      "need_id": "make_repair",
      "name_zh": "找人做、找人修",
      "question": "誰能幫我裁木板、焊鐵架、修電器？",
      "examples": "工廠；木工；鐵工；修理店；維修中心"
    },
    {
      "need_id": "borrow",
      "name_zh": "借工具、借空間",
      "question": "哪裡借得到電鑽、有地方可以施工？",
      "examples": "維修中心；創客空間；工具圖書館；閒置空間"
    },
    {
      "need_id": "transport",
      "name_zh": "運送",
      "question": "怎麼把東西搬過去？",
      "examples": "貨運；搬家；租車；可借推車或貨運自行車的地方"
    },
    {
      "need_id": "reuse",
      "name_zh": "回收再利用",
      "question": "哪裡有不要的材料、木屑、咖啡渣？",
      "examples": "回收場；二手店；有邊角料的工坊；咖啡店"
    },
    {
      "need_id": "community",
      "name_zh": "社區據點",
      "question": "附近有誰在做類似的事？",
      "examples": "堆肥站；社區園圃；社區組織"
    }
  ],
  "resource_classes": [
    {
      "class_id": "material",
      "name_zh": "物料",
      "description": "可以買、拿或交換的東西，包括廢料與副產物"
    },
    {
      "class_id": "tool",
      "name_zh": "工具",
      "description": "可以借用或租用的工具與設備"
    },
    {
      "class_id": "space",
      "name_zh": "空間",
      "description": "作業、暫存或可接收成品的空間"
    },
    {
      "class_id": "skill",
      "name_zh": "技能",
      "description": "做或修的能力（掛在據點或組織下，不建個人檔案）"
    },
    {
      "class_id": "knowledge",
      "name_zh": "知識",
      "description": "可以請教的專業知識或經驗"
    },
    {
      "class_id": "transport",
      "name_zh": "運輸",
      "description": "搬運物品的載具或服務"
    }
  ],
  "resource_items": [
    {
      "item_id": "lumber",
      "class_id": "material",
      "name_zh": "木材",
      "description": "新木料（板材、角材）",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "durable_lumber",
      "class_id": "material",
      "name_zh": "耐腐木材",
      "description": "較耐腐的木料，例如國產材或防腐處理材",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "pallets",
      "class_id": "material",
      "name_zh": "棧板",
      "description": "可拆解再利用的木棧板（優先 HT 熱處理，避免 MB 燻蒸）",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "wood_offcuts",
      "class_id": "material",
      "name_zh": "木材邊角料",
      "description": "木作剩下的短料、碎料",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "hardware_parts",
      "class_id": "material",
      "name_zh": "五金零件",
      "description": "螺絲、鉸鍊、角鐵、扣具等",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "wood_finish",
      "class_id": "material",
      "name_zh": "防腐防水塗料",
      "description": "護木漆、防水漆等",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "mesh",
      "class_id": "material",
      "name_zh": "網材",
      "description": "防蟲網、鐵絲網",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "building_materials",
      "class_id": "material",
      "name_zh": "建材",
      "description": "板材以外的建材，例如磁磚、管材",
      "in_compost_bill": "no"
    },
    {
      "item_id": "metal_scrap",
      "class_id": "material",
      "name_zh": "金屬廢料",
      "description": "可再利用的金屬邊料",
      "in_compost_bill": "no"
    },
    {
      "item_id": "cardboard",
      "class_id": "material",
      "name_zh": "紙板紙箱",
      "description": "乾淨的紙箱，可當碳源",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "wood_chips",
      "class_id": "material",
      "name_zh": "木屑",
      "description": "木作或修剪產生的木屑，可當碳源",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "fallen_leaves",
      "class_id": "material",
      "name_zh": "落葉與修剪枝葉",
      "description": "可當碳源",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "food_scraps",
      "class_id": "material",
      "name_zh": "廚餘與蔬果殘渣",
      "description": "可當氮源",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "coffee_grounds",
      "class_id": "material",
      "name_zh": "咖啡渣",
      "description": "可當氮源",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "power_drill",
      "class_id": "tool",
      "name_zh": "電鑽",
      "description": "電鑽或起子機",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "saw",
      "class_id": "tool",
      "name_zh": "鋸子與切割機",
      "description": "手鋸、圓鋸、線鋸等",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "hand_tools",
      "class_id": "tool",
      "name_zh": "手工具",
      "description": "鎚子、捲尺、夾具等",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "welder",
      "class_id": "tool",
      "name_zh": "焊接設備",
      "description": "電焊等",
      "in_compost_bill": "no"
    },
    {
      "item_id": "digital_fabrication",
      "class_id": "tool",
      "name_zh": "數位製造設備",
      "description": "雷射切割、3D 列印、CNC",
      "in_compost_bill": "no"
    },
    {
      "item_id": "workshop_space",
      "class_id": "space",
      "name_zh": "作業空間",
      "description": "可以施工、組裝的空間",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "storage_space",
      "class_id": "space",
      "name_zh": "暫存空間",
      "description": "暫放材料或成品的空間",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "compost_offtake",
      "class_id": "space",
      "name_zh": "堆肥去化空間",
      "description": "可以接收成品堆肥的綠地、園圃、花圃",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "woodworking",
      "class_id": "skill",
      "name_zh": "木作",
      "description": "裁切、組裝、木工修繕",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "metalworking",
      "class_id": "skill",
      "name_zh": "金屬加工",
      "description": "焊接、鐵件加工",
      "in_compost_bill": "no"
    },
    {
      "item_id": "appliance_repair",
      "class_id": "skill",
      "name_zh": "電器維修",
      "description": "家電、小型電器修理",
      "in_compost_bill": "no"
    },
    {
      "item_id": "general_repair",
      "class_id": "skill",
      "name_zh": "一般修繕",
      "description": "水電、門窗、家具等日常修繕",
      "in_compost_bill": "no"
    },
    {
      "item_id": "compost_management",
      "class_id": "knowledge",
      "name_zh": "堆肥管理",
      "description": "碳氮比、翻堆、病蟲害處理",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "wood_preservation",
      "class_id": "knowledge",
      "name_zh": "木材防腐",
      "description": "材料選擇、塗裝、結構設計",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "cargo_bike",
      "class_id": "transport",
      "name_zh": "貨運自行車",
      "description": "可載重的自行車或三輪車",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "hand_cart",
      "class_id": "transport",
      "name_zh": "手推車與拖車",
      "description": "手推車、自行車拖車",
      "in_compost_bill": "yes"
    },
    {
      "item_id": "small_truck",
      "class_id": "transport",
      "name_zh": "小貨車",
      "description": "小貨車租借或司機服務",
      "in_compost_bill": "no"
    },
    {
      "item_id": "delivery_service",
      "class_id": "transport",
      "name_zh": "貨運與搬家服務",
      "description": "付費運送",
      "in_compost_bill": "no"
    }
  ],
  "access_modes": [
    {
      "access_id": "sell",
      "name_zh": "售",
      "description": "付錢購買"
    },
    {
      "access_id": "lend",
      "name_zh": "借",
      "description": "免費或押金借用，用完歸還"
    },
    {
      "access_id": "give",
      "name_zh": "贈",
      "description": "免費提供，不需歸還（例如邊角料、木屑）"
    },
    {
      "access_id": "service",
      "name_zh": "服務",
      "description": "付費代工、維修或運送"
    },
    {
      "access_id": "exchange",
      "name_zh": "交換",
      "description": "以物易物或互惠交換"
    }
  ]
};
