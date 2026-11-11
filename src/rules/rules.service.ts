import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AlertRule } from './entities/alert-rule.entity.js';
import { Repository } from 'typeorm';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto.js';
import { UpdateAlertRuleDto } from './dto/update-alert-rule.dto.js';

@Injectable()
export class RulesService {
    constructor(
        @InjectRepository(AlertRule)
        private readonly alertRuleRepository: Repository<AlertRule>,
    ) {};

    async create(dto: CreateAlertRuleDto): Promise<AlertRule> {
        const alertRule = this.alertRuleRepository.create(dto);

        return this.alertRuleRepository.save(alertRule);
    }

    async findAll(): Promise<AlertRule[]> {
        return this.alertRuleRepository.find({
            order: {
                createdAt: 'DESC',
            }
        });
    }

    // Rules the engine applies to a new alert of this type. 
    findEnabledByType(type: string): Promise<AlertRule[]> {
        return this.alertRuleRepository.find({
            where: { type, isEnabled: true },
        });
    }

    async findOne(id: string): Promise<AlertRule> {
        const alertRule = await this.alertRuleRepository.findOne({
            where: { id }
        });

        if(!alertRule) {
            throw new NotFoundException(`Alert rule with ID ${id} not found`);
        }

        return alertRule;
    }

    async update(id: string, dto: UpdateAlertRuleDto): Promise<AlertRule> {
        const alertRule = await this.findOne(id);

        // DTO class fields that weren't sent are present as `undefined`;
        // skip them so they don't wipe the loaded values.
        const changes = Object.fromEntries(
            Object.entries(dto).filter(([, value]) => value !== undefined),
        );
        Object.assign(alertRule, changes);

        return this.alertRuleRepository.save(alertRule);
    }  
}
