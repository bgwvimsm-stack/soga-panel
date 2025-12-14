-- 为礼品卡增加单个用户的使用次数限制
ALTER TABLE gift_card_batches ADD COLUMN per_user_limit INTEGER;
ALTER TABLE gift_cards ADD COLUMN per_user_limit INTEGER;
